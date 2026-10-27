import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

import { runMigrations } from '../migrations/runMigrations.js';
import { migrations } from '../migrations/index.js';
import { PostgresWeatherRepository } from '../../repositories/PostgresWeatherRepository.js';
import { findShortfalls } from '../import/verifyImport.js';

/**
 * THE SQL, AGAINST A REAL POSTGRES.
 *
 * Every database defect this project has had was invisible to the other three
 * gates, because tests, typecheck and build do not open a connection:
 *
 *   - the import keyed weather on the legacy id and dropped 31 days whose ids
 *     collided with rows the sync had allocated
 *   - its verification compared TABLE TOTALS, so 78 imported + 31 pre-existing
 *     equalled the 109 in sqlite and ROLLBACK never fired
 *   - the backfill wrote through an upsert, so filling a gap REWROTE 30 rows
 *     that were already there
 *   - `pg` parses a DATE column into a JS Date, so a naive key comparison
 *     matches nothing
 *
 * All four are database behaviour. None could have been caught by a unit test,
 * and each was found by a person looking at a live table.
 *
 * GATED ON `POSTGRES_TEST_URL`, and skipped without it. That is deliberate and
 * it is a real limitation, stated rather than hidden: a skipped test proves
 * nothing, and `Tests 388 passed` must never be read as "the SQL works". It
 * cannot point at the deployed database — the production credential is not
 * available here by design, and a test that truncates tables must never be able
 * to reach real data.
 *
 * To run it:
 *
 *   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=house_heating_test --name hh-pgtest postgres:16
 *   POSTGRES_TEST_URL=postgres://postgres:test@localhost:55432/house_heating_test \
 *     npm test -- src/db/integration
 *   docker rm -f hh-pgtest
 */

const url = process.env.POSTGRES_TEST_URL;

describe.skipIf(!url)('the SQL, against a real Postgres', () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    client = await pool.connect();

    // A clean schema per run. Dropping CASCADE rather than truncating so a
    // migration change cannot leave a stale column behind and pass.
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(client, migrations);
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  it('applies every migration to an empty database', async () => {
    const applied = await client.query<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version;',
    );

    expect(applied.rows.map((r) => r.version)).toEqual(migrations.map((m) => m.version));
  });

  it('made gauge_percent_before nullable — migration 003, never applied before', async () => {
    const column = await client.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'fuel_fills' AND column_name = 'gauge_percent_before';`,
    );

    expect(column.rows[0].is_nullable).toBe('YES');
  });

  describe('insertIfAbsent', () => {
    const day = (date: string, station: string, hdd: number) => ({
      date,
      station,
      maxTemp: null,
      minTemp: null,
      meanTemp: 18 - hdd,
      hdd,
      source: `climate-archive:${station}`,
    });

    it('inserts a day that is absent and reports that it wrote', async () => {
      const repository = new PostgresWeatherRepository(client);

      await expect(repository.insertIfAbsent(day('2025-02-01', 'ZSM', 30))).resolves.toBe(
        true,
      );
    });

    it('reports FALSE for a day already present, and leaves it untouched', async () => {
      // The whole of Franco's "missing only" ruling rests on this. ON CONFLICT
      // DO NOTHING returns no row, and the absence of a row is the signal.
      const repository = new PostgresWeatherRepository(client);

      await repository.insertIfAbsent(day('2025-02-02', 'ZSM', 25));

      const second = await repository.insertIfAbsent(day('2025-02-02', 'YSM', 99));

      expect(second).toBe(false);

      // Provenance is what proves it was not rewritten — the counts cannot.
      // This is the check Circuit used on the live table, as a test.
      const row = await client.query<{ station: string; hdd: string }>(
        `SELECT station, hdd FROM weather_data WHERE date = '2025-02-02';`,
      );

      expect(row.rows).toHaveLength(1);
      expect(row.rows[0].station).toBe('ZSM');
      expect(Number(row.rows[0].hdd)).toBe(25);
    });

    it('is idempotent across a whole range', async () => {
      const repository = new PostgresWeatherRepository(client);
      const range = ['2025-03-01', '2025-03-02', '2025-03-03'].map((d) => day(d, 'ZSM', 20));

      const first = await Promise.all(range.map((d) => repository.insertIfAbsent(d)));
      const second = await Promise.all(range.map((d) => repository.insertIfAbsent(d)));

      expect(first).toEqual([true, true, true]);
      expect(second).toEqual([false, false, false]);

      const count = await client.query<{ n: string }>(
        `SELECT COUNT(*)::int AS n FROM weather_data WHERE date BETWEEN '2025-03-01' AND '2025-03-03';`,
      );

      expect(Number(count.rows[0].n)).toBe(3);
    });
  });

  describe('the import verification query', () => {
    it('matches DATE keys compared as text — the trap pg sets', async () => {
      // `pg` parses a DATE column into a JS Date, whose String() is
      // "Sat Feb 01 2025 ..." and never equals '2025-02-01'. And a text[]
      // parameter against a date column raises "operator does not exist".
      // A naive version of this query reports every row missing and rolls back
      // a perfectly good import.
      const attempted = ['2025-02-01', '2025-02-02', '2099-01-01'];

      const present = await client.query<{ key: string }>(
        `SELECT date::text AS key FROM weather_data WHERE date::text = ANY($1::text[]);`,
        [attempted],
      );

      expect(present.rows.map((r) => r.key).sort()).toEqual(['2025-02-01', '2025-02-02']);
    });

    it('goes RED when a row the import attempted is absent', async () => {
      // The 2026-10-25 partial import, as a failing check. The old verification
      // compared table totals and passed; this one compares attempted keys
      // against present keys and cannot.
      const attempted = ['2025-02-01', '2025-02-02', '2099-01-01'];

      const present = await client.query<{ key: string }>(
        `SELECT date::text AS key FROM weather_data WHERE date::text = ANY($1::text[]);`,
        [attempted],
      );

      const shortfalls = findShortfalls([
        {
          table: 'weather_data',
          attempted,
          present: present.rows.map((r) => r.key),
        },
      ]);

      expect(shortfalls).toHaveLength(1);
      expect(shortfalls[0].missing).toEqual(['2099-01-01']);
    });

    it('a table TOTAL cannot distinguish a short import — the original defect', async () => {
      // Demonstrates why the old check passed. The table holds more rows than
      // the import attempted, so a total-vs-total comparison is satisfied while
      // an attempted row is missing.
      const total = await client.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM weather_data;',
      );

      const attempted = ['2025-02-01', '2099-01-01'];

      // The old predicate: "is the table at least as big as what I attempted?"
      expect(total.rows[0].n >= attempted.length).toBe(true);

      // The new one disagrees, which is the entire point.
      const present = await client.query<{ key: string }>(
        `SELECT date::text AS key FROM weather_data WHERE date::text = ANY($1::text[]);`,
        [attempted],
      );

      expect(
        findShortfalls([
          { table: 'weather_data', attempted, present: present.rows.map((r) => r.key) },
        ]),
      ).toHaveLength(1);
    });
  });

  it('enforces one row per date, which every conflict clause here depends on', async () => {
    await expect(
      client.query(
        `INSERT INTO weather_data (date, mean_temp, hdd, source)
         VALUES ('2025-02-01', -5, 23, 'duplicate attempt');`,
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
