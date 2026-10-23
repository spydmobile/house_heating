import { describe, it, expect } from 'vitest';
import { runMigrations, type Migration, type MigrationClient } from './runMigrations';

/**
 * The migration runner replaces `CREATE TABLE IF NOT EXISTS` on every boot.
 *
 * That idiom cannot express a schema CHANGE — it can only ever create something
 * absent. The next approved piece of work needs `weather_data.station` added,
 * which is exactly the case it cannot handle.
 *
 * The runner takes a client as an argument (dependency inversion: the port is
 * declared here, `pg` is an adapter at the edge). These tests use a recording
 * fake rather than a live database, which is the one place mocking is right —
 * external I/O.
 */

interface Recorded {
  sql: string;
  params?: unknown[];
}

function fakeClient(appliedVersions: number[] = []): MigrationClient & {
  calls: Recorded[];
} {
  const calls: Recorded[] = [];

  return {
    calls,
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });

      // The runner asks which versions are already recorded.
      if (/select\s+version\s+from\s+schema_migrations/i.test(sql)) {
        return { rows: appliedVersions.map((version) => ({ version })) };
      }

      return { rows: [] };
    },
  };
}

const migrations: Migration[] = [
  { version: 2, name: 'second', sql: 'SELECT 2;' },
  { version: 1, name: 'first', sql: 'SELECT 1;' },
  { version: 3, name: 'third', sql: 'SELECT 3;' },
];

function appliedSql(client: { calls: Recorded[] }): string[] {
  return client.calls
    .map((call) => call.sql)
    .filter((sql) => /^SELECT \d+;$/.test(sql));
}

describe('runMigrations', () => {
  it('applies pending migrations in ascending version order, not declaration order', async () => {
    const client = fakeClient();

    await runMigrations(client, migrations);

    expect(appliedSql(client)).toEqual(['SELECT 1;', 'SELECT 2;', 'SELECT 3;']);
  });

  it('skips migrations whose version is already recorded', async () => {
    const client = fakeClient([1, 2]);

    await runMigrations(client, migrations);

    expect(appliedSql(client)).toEqual(['SELECT 3;']);
  });

  /**
   * POSITIVE CONTROL for the test above. Without it, a runner that applied
   * nothing at all would pass "skips what is recorded", and the suite could not
   * tell "skipped correctly" from "did nothing".
   */
  it('applies nothing when every migration is already recorded', async () => {
    const client = fakeClient([1, 2, 3]);

    await runMigrations(client, migrations);

    expect(appliedSql(client)).toEqual([]);
  });

  it('records each applied version so it is not applied twice', async () => {
    const client = fakeClient([1, 2]);

    await runMigrations(client, migrations);

    const inserts = client.calls.filter((call) =>
      /insert\s+into\s+schema_migrations/i.test(call.sql),
    );

    expect(inserts).toHaveLength(1);
    expect(inserts[0].params).toContain(3);
  });

  /**
   * Fail-fast. A duplicated version means two migrations claim the same slot
   * and which one ran would depend on declaration order — silently divergent
   * schemas across environments. Refuse before touching the database.
   */
  it('throws on duplicate versions before applying anything', async () => {
    const client = fakeClient();
    const duplicated: Migration[] = [
      { version: 1, name: 'first', sql: 'SELECT 1;' },
      { version: 1, name: 'also first', sql: 'SELECT 99;' },
    ];

    await expect(runMigrations(client, duplicated)).rejects.toThrow(/duplicate/i);
    expect(appliedSql(client)).toEqual([]);
  });
});
