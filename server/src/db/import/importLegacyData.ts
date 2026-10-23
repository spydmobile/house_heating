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

interface TableCount {
  table: string;
  sqlite: number;
  postgres: number;
}

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

    for (const day of transformed.weather) {
      await client.query(
        `INSERT INTO weather_data (id, date, max_temp, min_temp, mean_temp, hdd, source, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING;`,
        [
          day.id, day.date, day.maxTemp, day.minTemp, day.meanTemp, day.hdd,
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

    // 5. VERIFY BEFORE COMMITTING. A count mismatch rolls the whole thing back.
    const counts: TableCount[] = [];

    for (const [table, expected] of [
      ['fuel_fills', transformed.fills.length],
      ['gauge_readings', transformed.readings.length],
      ['weather_data', transformed.weather.length],
      ['hvac_reports', transformed.hvac.length],
      ['settings', settings.length],
    ] as [string, number][]) {
      const result = await client.query(`SELECT COUNT(*)::int AS n FROM ${table};`);
      counts.push({ table, sqlite: expected, postgres: result.rows[0].n });
    }

    const short = counts.filter((c) => c.postgres < c.sqlite);

    if (short.length > 0) {
      await client.query('ROLLBACK');

      throw new Error(
        'Row counts are short after import, rolling back: ' +
          short.map((c) => `${c.table} ${c.postgres} < ${c.sqlite}`).join(', '),
      );
    }

    await client.query('COMMIT');

    console.log('[import] committed:');
    for (const c of counts) {
      console.log(`  ${c.table.padEnd(16)} sqlite ${c.sqlite} -> postgres ${c.postgres}`);
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
