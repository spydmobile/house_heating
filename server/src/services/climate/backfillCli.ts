/**
 * Climate-archive backfill CLI.
 *
 * Fills gaps in weather_data from the Environment Canada daily climate archive,
 * ZSM first and YSM consulted only for the days ZSM lacks.
 *
 *   npm run backfill -- --from 2025-01-01 --to 2025-03-31           # dry run
 *   npm run backfill -- --from 2025-01-01 --to 2025-03-31 --write   # writes
 *
 * DRY RUN IS THE DEFAULT, as it is for the legacy import. The dry run reaches
 * the archive for real and reports exactly what it would write — and unlike the
 * import's dry run, it DOES connect to Postgres, because reading the current
 * coverage is the point. (The import's dry run returns before its pool is
 * created, which Circuit caught on 2026-10-25: a clean dry run there proves
 * nothing about the credential or the network. This one does not have that hole.)
 *
 * The archive base URL is a constant, not configuration. loadServerConfig
 * deliberately has no defaults and six required variables; adding a seventh
 * would make the RUNNING container fail to start on its next restart, which is
 * a steep price for a stable public endpoint. The station codes are already
 * constants in resolveStation for the same reason.
 */

import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

import { loadServerConfig } from '../../config/loadServerConfig.js';
import { buildPoolConfig } from '../../db/buildPoolConfig.js';
import { PostgresWeatherRepository } from '../../repositories/PostgresWeatherRepository.js';
import { createClimateArchive } from './createClimateArchive.js';
import { createBackfill, type BackfillDay, type BackfillReport } from './createBackfill.js';
import { parseBackfillArgs } from './parseBackfillArgs.js';

dotenv.config({ path: path.join(__dirname, '../../../../.env') });

/** Environment Canada MSC GeoMet OGC API. */
export const MSC_ARCHIVE_URL = 'https://api.weather.gc.ca';

/** Prints the report in full, including the parts that are nobody's good news. */
export function printReport(report: BackfillReport, write: boolean): void {
  const mode = write ? 'WRITE MODE' : 'DRY RUN — nothing was written';

  console.log(`[backfill] ${mode}`);
  console.log(`[backfill] range ${report.from}..${report.to} (${report.expectedDays} days)`);
  console.log(
    `[backfill] ${write ? 'written' : 'would write'}: ${report.written} of ${report.expectedDays}`,
  );

  if (report.fromFallback.length > 0) {
    console.log(
      `[backfill] ${report.fromFallback.length} day(s) came from YSM because ZSM lacked them: ` +
        report.fromFallback.join(', '),
    );
  }

  // Recorded, never filled in. A day the archive itself has no measurement for
  // is not a day we may invent.
  if (report.missing.length > 0) {
    console.log(
      `[backfill] ${report.missing.length} day(s) MISSING at both stations, left absent: ` +
        report.missing.join(', '),
    );
  }

  // calculateHDD agreed with the archive across 176 days with zero
  // discrepancies, so any discrepancy here is worth looking at rather than
  // averaging away.
  if (report.hddDiscrepancies.length > 0) {
    console.log(`[backfill] ${report.hddDiscrepancies.length} HDD DISCREPANCY(IES):`);

    for (const d of report.hddDiscrepancies) {
      console.log(`  ${d.date}  archive ${d.archive}  calculated ${d.calculated}`);
    }
  }

  if (report.errors.length > 0) {
    console.log(`[backfill] ${report.errors.length} ERROR(S):`);

    for (const error of report.errors) {
      console.log(`  ${error}`);
    }
  }
}

async function main(): Promise<void> {
  const { from, to, write } = parseBackfillArgs(process.argv.slice(2));

  const config = loadServerConfig(process.env);
  const pool = new pg.Pool(buildPoolConfig(config));
  const client = await pool.connect();

  try {
    const repository = new PostgresWeatherRepository(client);

    const archive = createClimateArchive({
      fetch: (url) => fetch(url),
      baseUrl: MSC_ARCHIVE_URL,
    });

    // A dry run must reach the archive and refuse to touch the store. Swapping
    // the store rather than branching inside the backfill keeps ONE code path:
    // the run that reports is the run that would write. report.written counts
    // the days either way, so the dry run's number is the real forecast.
    const weather = write
      ? { save: (day: BackfillDay) => repository.save(day) }
      : { save: async (day: BackfillDay) => day };

    const backfill = createBackfill({ archive, weather });
    const report = await backfill.run(from, to);

    printReport(report, write);

    if (report.errors.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`[backfill] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
