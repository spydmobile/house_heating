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
    `[backfill] ${write ? 'inserted' : 'would insert'}: ${report.written} of ${report.expectedDays}`,
  );

  // Said even when it is zero. "0 already present" and silence are different
  // statements, and the silence is the one that let an overwrite go unnamed.
  console.log(
    `[backfill] ${report.skipped.length} day(s) already present, left untouched` +
      (report.skipped.length > 0 && report.skipped.length <= 10
        ? `: ${report.skipped.join(', ')}`
        : ''),
  );

  if (report.fromSecondary.length > 0) {
    console.log(
      `[backfill] ${report.fromSecondary.length} day(s) came from YSM because ZSM lacked them: ` +
        report.fromSecondary.join(', '),
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

    // A dry run must reach the archive, read the REAL coverage, and write
    // nothing. Swapping the store rather than branching inside the backfill
    // keeps one code path through createBackfill.
    //
    // The dry store used to accept every day unconditionally, so it reported
    // "would write 90" for a range Postgres already half held. The comment here
    // claimed report.written was "the real forecast" — a sentence that happened
    // to be true, because the write path was an upsert, for a reason the
    // comment never gave. Both are fixed: the write path inserts if absent, and
    // the dry store consults the same coverage it would consult.
    const existing = write
      ? null
      : new Set((await repository.findBetween(from, to)).map((d) => d.date));

    const weather = write
      ? { saveIfAbsent: (day: BackfillDay) => repository.insertIfAbsent(day) }
      : { saveIfAbsent: async (day: BackfillDay) => !existing!.has(day.date) };

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
