import path from 'path';
import dotenv from 'dotenv';
import pg from 'pg';

import { loadServerConfig } from './config/loadServerConfig.js';
import { buildPoolConfig } from './db/buildPoolConfig.js';
import { runMigrations } from './db/migrations/runMigrations.js';
import { migrations } from './db/migrations/index.js';
import { createApp } from './app/createApp.js';

import { PostgresFuelFillRepository } from './repositories/PostgresFuelFillRepository.js';
import { PostgresGaugeReadingRepository } from './repositories/PostgresGaugeReadingRepository.js';
import { PostgresWeatherRepository } from './repositories/PostgresWeatherRepository.js';
import { PostgresHvacReportRepository } from './repositories/PostgresHvacReportRepository.js';
import { PostgresMonthlyEfficiencyQuery } from './repositories/PostgresMonthlyEfficiencyQuery.js';
import { PostgresAnalysisQuery } from './repositories/PostgresAnalysisQuery.js';

import { createFillsRouter } from './routes/createFillsRouter.js';
import { createReadingsRouter } from './routes/createReadingsRouter.js';
import { createWeatherRouter } from './routes/createWeatherRouter.js';
import { createHvacRouter } from './routes/createHvacRouter.js';
import { createAnalysisRouter } from './routes/createAnalysisRouter.js';
import { createWeatherFetcher } from './services/createWeatherFetcher.js';
import { createWeatherSync } from './services/createWeatherSync.js';
import { fetchForecast } from './services/forecastFetcher.js';
import { config as domainConfig } from './config.js';

/**
 * COMPOSITION ROOT. The only file that knows about `pg`, reads `process.env`,
 * or constructs a concrete repository.
 *
 * Everything else takes ports as arguments, which is what lets the application
 * be exercised without a database and what keeps the dependency arrows pointing
 * inward.
 *
 * Boot order is deliberate:
 *   1. Load and VALIDATE configuration — crash here if anything is missing.
 *   2. Connect, and PROVE the connection with a real query.
 *   3. Run migrations, before any request can arrive.
 *   4. Only then listen.
 *
 * A server that accepts requests before its schema exists answers them wrongly
 * rather than not at all.
 */

// This build targets CommonJS, where `__dirname` is already defined — the
// ESM `import.meta.url` form does not compile here.
// The .env lives at the repository root, one level above server/.
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function main(): Promise<void> {
  // 1. Fail fast. A missing variable throws here naming itself, rather than
  //    producing a service that starts and is quietly broken.
  const config = loadServerConfig(process.env);
  const poolConfig = buildPoolConfig(config);

  const pool = new pg.Pool(poolConfig);

  // Errors on an IDLE client — the server closing a connection, a failover —
  // are emitted on the pool. Unhandled, they take the process down with a
  // stack trace that names nothing useful.
  pool.on('error', (error) => {
    console.error('[house-heating] idle database client error:', error);
  });

  // 2. Prove the connection rather than assume it. `new Pool()` is lazy, so
  //    without this a bad credential or host surfaces as a failing request
  //    later instead of a refusal to start.
  try {
    await pool.query('SELECT 1;');
    console.log(
      `[house-heating] connected to ${poolConfig.database} at ` +
        `${poolConfig.host}:${poolConfig.port} as ${poolConfig.user}`,
    );
  } catch (error) {
    // The password is never included — only where and as whom we tried.
    throw new Error(
      `Cannot reach the database at ${poolConfig.host}:${poolConfig.port} ` +
        `(database ${poolConfig.database}, user ${poolConfig.user}). ` +
        `Refusing to start. Cause: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }

  // 3. Migrate before serving. Ordered, idempotent, and it refuses outright if
  //    two migrations claim the same version.
  await runMigrations(pool, migrations);
  console.log(`[house-heating] migrations applied (${migrations.length} known)`);

  // 4. Compose. Every repository is an adapter over the one pool.
  const fills = new PostgresFuelFillRepository(pool);
  const readings = new PostgresGaugeReadingRepository(pool);
  const weather = new PostgresWeatherRepository(pool);
  const hvac = new PostgresHvacReportRepository(pool);
  const monthlyEfficiency = new PostgresMonthlyEfficiencyQuery(pool);
  const analysis = new PostgresAnalysisQuery(pool);

  const weatherFetcher = createWeatherFetcher({
    weather,
    fetch: (url: string) => fetch(url),
    baseUrl: domainConfig.mscDatamartUrl,
  });

  const weatherSync = createWeatherSync({ weather, fetcher: weatherFetcher });

  const app = createApp({
    // The built client, served from the same origin as the API: one port, one
    // proxy host, and no absolute host baked into the bundle.
    clientDistPath: path.join(__dirname, '../../client/dist'),
    routers: {
      fills: createFillsRouter({ fills }),
      readings: createReadingsRouter({
        readings,
        // Narrow port: the enrichment needs degree days per period and nothing
        // else from weather.
        weather: { hddForPeriod: (from, to) => weather.hddForPeriod(from, to) },
      }),
      weather: createWeatherRouter({ weather, fetcher: weatherFetcher }),
      hvac: createHvacRouter({ hvac, efficiency: monthlyEfficiency }),
      analysis: createAnalysisRouter({
        fills: {
          list: () => fills.list(),
          latest: () => analysis.latestFuelFill(),
          addedAfter: (date) => analysis.fillsAddedAfter(date),
          between: (from, to) => analysis.fillsBetweenInclusive(from, to),
        },
        readings: {
          latest: () => analysis.latestGaugeReading(),
          list: () => readings.list(),
        },
        weather: {
          hddBetweenExclusive: (from, to) => analysis.hddBetweenExclusive(from, to),
          summaryForEfficiency: (from, to) =>
            analysis.weatherSummaryForEfficiency(from, to),
          totalHddAllTime: () => analysis.totalHddAllTime(),
        },
        forecast: { fetchForecast },
      }),
    },
  });

  const server = app.listen(Number(config.port), () => {
    console.log(`[house-heating] listening on ${config.port}`);

    // Started AFTER the server is accepting requests, so a slow Environment
    // Canada does not delay readiness. Its failures are contained internally
    // and never reach here.
    weatherSync.start();
  });

  /**
   * Containers stop with SIGTERM. Without handling it the process is killed
   * mid-query and Postgres is left to time the connection out — which appears
   * in the logs as a database fault rather than an ordinary restart.
   */
  const shutdown = (signal: string): void => {
    console.log(`[house-heating] ${signal} received, shutting down`);

    weatherSync.stop();

    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });

    // Never hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  // Crash loudly. A container that exits non-zero gets restarted and its reason
  // is in the logs; one that limps along serves wrong answers indefinitely.
  console.error('[house-heating] failed to start:', error);
  process.exit(1);
});
