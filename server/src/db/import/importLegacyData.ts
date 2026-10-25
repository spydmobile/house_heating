import path from 'path';
import Database from 'better-sqlite3';
import pg from 'pg';
import dotenv from 'dotenv';

import { loadServerConfig } from '../../config/loadServerConfig.js';
import { buildPoolConfig } from '../buildPoolConfig.js';
import { runMigrations } from '../migrations/runMigrations.js';
import { migrations } from '../migrations/index.js';
import {
  transformFuelFill,
  transformGaugeReading,
  transformWeatherDay,
  transformHvacReport,
  type LegacyFuelFill,
  type LegacyGaugeReading,
  type LegacyWeatherDay,
  type LegacyHvacReport,
} from './transformLegacyRows.js';
import {
  findShortfalls,
  describeShortfall,
  type TableVerification,
} from './verifyImport.js';

/**
 * ONE-TIME import of the legacy SQLite database into Postgres.
 *
 * This moves the only copy of the data the project exists to analyse — six
 * fuel fills, seven gauge readings, 109 weather days, fifteen HVAC reports.
 * Everything here is built around that being irreplaceable:
 *
 *   DRY RUN BY DEFAULT. It reads, transforms and reports without writing
 *   anything unless `--write` is passed. A transform error is found before any
 *   row is inserted, not halfway through.
 *
 *   ONE TRANSACTION. Either the whole history lands or none of it does. A
 *   partial import is the worst outcome: it looks like success and silently
 *   changes every total computed from it.
 *
 *   ORIGINAL IDS PRESERVED, with ON CONFLICT (id) DO NOTHING, so a second run
 *   adds nothing rather than appending the history again.
 *
 *   SEQUENCES RESET afterwards. Inserting explicit ids does NOT advance an
 *   identity sequence, so without this the next ordinary insert collides with
 *   an imported id and fails — a failure that would appear days later, from the
 *   phone, looking like a bug in the app.
 *
 *   VERIFIED BY COUNT on both sides before committing.
 *
 * Usage, from server/:
 *   npm run import:legacy              # dry run, writes nothing
 *   npm run import:legacy -- --write   # performs the import
 */

const SQLITE_PATH = path.join(__dirname, '../../../../data/fuel_tracker.db');

dotenv.config({ path: path.join(__dirname, '../../../../.env') });

async function main(): Promise<void> {
  const write = process.argv.includes('--write');

  console.log(
    write
      ? '[import] WRITE MODE — changes will be committed'
      : '[import] DRY RUN — nothing will be written (pass --write to import)',
  );

  // 1. READ AND TRANSFORM FIRST. Any bad row fails here, with nothing written.
  const sqlite = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });

  const fills = sqlite
    .prepare('SELECT * FROM fuel_fills ORDER BY id')
    .all() as LegacyFuelFill[];
  const readings = sqlite
    .prepare('SELECT * FROM gauge_readings ORDER BY id')
    .all() as LegacyGaugeReading[];
  const weather = sqlite
    .prepare('SELECT * FROM weather_data ORDER BY id')
    .all() as LegacyWeatherDay[];
  const hvac = sqlite
    .prepare('SELECT * FROM hvac_reports ORDER BY id')
    .all() as LegacyHvacReport[];
  const settings = sqlite
    .prepare('SELECT key, value FROM settings')
    .all() as { key: string; value: string | null }[];

  sqlite.close();

  const transformed = {
    fills: fills.map(transformFuelFill),
    readings: readings.map(transformGaugeReading),
    weather: weather.map(transformWeatherDay),
    hvac: hvac.map(transformHvacReport),
  };

  console.log(
    `[import] read and transformed: ${transformed.fills.length} fills, ` +
      `${transformed.readings.length} readings, ${transformed.weather.length} weather days, ` +
      `${transformed.hvac.length} hvac reports, ${settings.length} settings`,
  );

  if (!write) {
    console.log('[import] dry run complete — every row transformed without error');
    return;
  }

  // 2. Connect and migrate.
  const config = loadServerConfig(process.env);
  const pool = new pg.Pool(buildPoolConfig(config));
  const client = await pool.connect();

  try {
    await runMigrations(client, migrations);

    // 3. ONE TRANSACTION. All of it, or none of it.
    await client.query('BEGIN');

    for (const fill of transformed.fills) {
      await client.query(
        `INSERT INTO fuel_fills (
           id, client_uuid, date, gauge_percent_before, liters_added,
           liters_before_fill, price_per_liter, discount, gst, total_cost,
           notes, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO NOTHING;`,
        [
          fill.id, fill.clientUuid, fill.date, fill.gaugePercentBefore,
          fill.litersAdded, fill.litersBeforeFill, fill.pricePerLiter,
          fill.discount, fill.gst, fill.totalCost, fill.notes, fill.createdAt,
        ],
      );
    }

    for (const reading of transformed.readings) {
      await client.query(
        `INSERT INTO gauge_readings (id, client_uuid, date, gauge_percent, notes, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO NOTHING;`,
        [
          reading.id, reading.clientUuid, reading.date, reading.gaugePercent,
          reading.notes, reading.createdAt,
        ],
      );
    }

    // weather_data is keyed on DATE, not on the legacy id. The weather sync
    // allocates its own identity ids, so a legacy id means nothing here — on
    // 2026-10-25 that dropped 31 legacy days whose ids collided with synced
    // rows holding entirely different dates. `date` is the real key: migration
    // 001 declares it UNIQUE and PostgresWeatherRepository already upserts on
    // it. Letting the identity column allocate the id also makes a re-run
    // self-correcting rather than a second chance to collide.
    for (const day of transformed.weather) {
      await client.query(
        `INSERT INTO weather_data (date, max_temp, min_temp, mean_temp, hdd, source, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (date) DO NOTHING;`,
        [
          day.date, day.maxTemp, day.minTemp, day.meanTemp, day.hdd,
          day.source, day.createdAt,
        ],
      );
    }

    for (const report of transformed.hvac) {
      await client.query(
        `INSERT INTO hvac_reports (
           id, year, month, total_runtime_hours, avg_cycle_minutes,
           avg_outdoor_temp, avg_indoor_temp, avg_setpoint, notes, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING;`,
        [
          report.id, report.year, report.month, report.totalRuntimeHours,
          report.avgCycleMinutes, report.avgOutdoorTemp, report.avgIndoorTemp,
          report.avgSetpoint, report.notes, report.createdAt,
        ],
      );
    }

    for (const setting of settings) {
      await client.query(
        `INSERT INTO settings (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
        [setting.key, setting.value],
      );
    }

    // 4. ADVANCE THE SEQUENCES. Explicit ids do not move an identity sequence,
    //    so without this the next ordinary insert collides with an imported id.
    //    That failure would surface days later, from the phone, looking like an
    //    application bug.
    for (const table of ['fuel_fills', 'gauge_readings', 'weather_data', 'hvac_reports']) {
      await client.query(
        `SELECT setval(
           pg_get_serial_sequence('${table}', 'id'),
           COALESCE((SELECT MAX(id) FROM ${table}), 1),
           true
         );`,
      );
    }

    // 5. VERIFY BEFORE COMMITTING, BY KEY AND NOT BY TOTAL.
    //
    //    The original check compared each table's TOTAL row count to the sqlite
    //    count, and on 2026-10-25 that passed on a real partial import: 78
    //    imported legacy rows plus 31 pre-existing synced rows equalled the 109
    //    in sqlite. Both numbers were true; the comparison answered a different
    //    question than the one it was built for, so ROLLBACK never fired.
    //
    //    So each table is now verified on the SAME key its insert conflicts on,
    //    asking only about the rows this import actually attempted.
    const verifications: TableVerification[] = [];

    for (const { table, column, keys } of [
      { table: 'fuel_fills', column: 'id', keys: transformed.fills.map((r) => r.id) },
      { table: 'gauge_readings', column: 'id', keys: transformed.readings.map((r) => r.id) },
      { table: 'weather_data', column: 'date', keys: transformed.weather.map((r) => r.date) },
      { table: 'hvac_reports', column: 'id', keys: transformed.hvac.map((r) => r.id) },
      { table: 'settings', column: 'key', keys: settings.map((s) => s.key) },
    ] as { table: string; column: string; keys: (string | number)[] }[]) {
      // Compared AS TEXT on both sides deliberately. `pg` parses a DATE column
      // into a JS Date, whose String() is "Sat Oct 25 2025 ..." and would never
      // match the legacy 'YYYY-MM-DD'; and a text[] parameter compared against
      // a date column raises "operator does not exist". `::text` on the column
      // yields 'YYYY-MM-DD' for a DATE, which is exactly the legacy form.
      const attempted = keys.map(String);

      const result = await client.query(
        `SELECT ${column}::text AS key FROM ${table} WHERE ${column}::text = ANY($1::text[]);`,
        [attempted],
      );

      verifications.push({
        table,
        attempted,
        present: result.rows.map((r: { key: string }) => r.key),
      });
    }

    const shortfalls = findShortfalls(verifications);

    if (shortfalls.length > 0) {
      await client.query('ROLLBACK');

      throw new Error(
        'Rows this import attempted are missing after it ran, rolling back:\n  ' +
          shortfalls.map(describeShortfall).join('\n  '),
      );
    }

    await client.query('COMMIT');

    console.log('[import] committed:');
    for (const v of verifications) {
      console.log(
        `  ${v.table.padEnd(16)} attempted ${v.attempted.length} -> present ${v.present.length}`,
      );
    }

    console.log(
      '[import] NOTE: the 2026-02-24 fill was imported exactly as recorded, ' +
        'including gauge_percent_before = 0 with an empty liters_before_fill. ' +
        'That row is not credible and still needs auditing — the import did ' +
        'not repair it, deliberately.',
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[import] FAILED — nothing was committed:', error);
  process.exit(1);
});
