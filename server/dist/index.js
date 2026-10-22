"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const pg_1 = __importDefault(require("pg"));
const loadServerConfig_js_1 = require("./config/loadServerConfig.js");
const buildPoolConfig_js_1 = require("./db/buildPoolConfig.js");
const runMigrations_js_1 = require("./db/migrations/runMigrations.js");
const index_js_1 = require("./db/migrations/index.js");
const createApp_js_1 = require("./app/createApp.js");
const PostgresFuelFillRepository_js_1 = require("./repositories/PostgresFuelFillRepository.js");
const PostgresGaugeReadingRepository_js_1 = require("./repositories/PostgresGaugeReadingRepository.js");
const PostgresWeatherRepository_js_1 = require("./repositories/PostgresWeatherRepository.js");
const PostgresHvacReportRepository_js_1 = require("./repositories/PostgresHvacReportRepository.js");
const PostgresMonthlyEfficiencyQuery_js_1 = require("./repositories/PostgresMonthlyEfficiencyQuery.js");
const PostgresAnalysisQuery_js_1 = require("./repositories/PostgresAnalysisQuery.js");
const createFillsRouter_js_1 = require("./routes/createFillsRouter.js");
const createReadingsRouter_js_1 = require("./routes/createReadingsRouter.js");
const createWeatherRouter_js_1 = require("./routes/createWeatherRouter.js");
const createHvacRouter_js_1 = require("./routes/createHvacRouter.js");
const createAnalysisRouter_js_1 = require("./routes/createAnalysisRouter.js");
const createWeatherFetcher_js_1 = require("./services/createWeatherFetcher.js");
const createWeatherSync_js_1 = require("./services/createWeatherSync.js");
const forecastFetcher_js_1 = require("./services/forecastFetcher.js");
const config_js_1 = require("./config.js");
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
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../.env') });
async function main() {
    // 1. Fail fast. A missing variable throws here naming itself, rather than
    //    producing a service that starts and is quietly broken.
    const config = (0, loadServerConfig_js_1.loadServerConfig)(process.env);
    const poolConfig = (0, buildPoolConfig_js_1.buildPoolConfig)(config);
    const pool = new pg_1.default.Pool(poolConfig);
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
        console.log(`[house-heating] connected to ${poolConfig.database} at ` +
            `${poolConfig.host}:${poolConfig.port} as ${poolConfig.user}`);
    }
    catch (error) {
        // The password is never included — only where and as whom we tried.
        throw new Error(`Cannot reach the database at ${poolConfig.host}:${poolConfig.port} ` +
            `(database ${poolConfig.database}, user ${poolConfig.user}). ` +
            `Refusing to start. Cause: ${error instanceof Error ? error.message : String(error)}`);
    }
    // 3. Migrate before serving. Ordered, idempotent, and it refuses outright if
    //    two migrations claim the same version.
    await (0, runMigrations_js_1.runMigrations)(pool, index_js_1.migrations);
    console.log(`[house-heating] migrations applied (${index_js_1.migrations.length} known)`);
    // 4. Compose. Every repository is an adapter over the one pool.
    const fills = new PostgresFuelFillRepository_js_1.PostgresFuelFillRepository(pool);
    const readings = new PostgresGaugeReadingRepository_js_1.PostgresGaugeReadingRepository(pool);
    const weather = new PostgresWeatherRepository_js_1.PostgresWeatherRepository(pool);
    const hvac = new PostgresHvacReportRepository_js_1.PostgresHvacReportRepository(pool);
    const monthlyEfficiency = new PostgresMonthlyEfficiencyQuery_js_1.PostgresMonthlyEfficiencyQuery(pool);
    const analysis = new PostgresAnalysisQuery_js_1.PostgresAnalysisQuery(pool);
    const weatherFetcher = (0, createWeatherFetcher_js_1.createWeatherFetcher)({
        weather,
        fetch: (url) => fetch(url),
        baseUrl: config_js_1.config.mscDatamartUrl,
    });
    const weatherSync = (0, createWeatherSync_js_1.createWeatherSync)({ weather, fetcher: weatherFetcher });
    const app = (0, createApp_js_1.createApp)({
        // The built client, served from the same origin as the API: one port, one
        // proxy host, and no absolute host baked into the bundle.
        clientDistPath: path_1.default.join(__dirname, '../../client/dist'),
        routers: {
            fills: (0, createFillsRouter_js_1.createFillsRouter)({ fills }),
            readings: (0, createReadingsRouter_js_1.createReadingsRouter)({
                readings,
                // Narrow port: the enrichment needs degree days per period and nothing
                // else from weather.
                weather: { hddForPeriod: (from, to) => weather.hddForPeriod(from, to) },
            }),
            weather: (0, createWeatherRouter_js_1.createWeatherRouter)({ weather, fetcher: weatherFetcher }),
            hvac: (0, createHvacRouter_js_1.createHvacRouter)({ hvac, efficiency: monthlyEfficiency }),
            analysis: (0, createAnalysisRouter_js_1.createAnalysisRouter)({
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
                    summaryForEfficiency: (from, to) => analysis.weatherSummaryForEfficiency(from, to),
                    totalHddAllTime: () => analysis.totalHddAllTime(),
                },
                forecast: { fetchForecast: forecastFetcher_js_1.fetchForecast },
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
    const shutdown = (signal) => {
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
