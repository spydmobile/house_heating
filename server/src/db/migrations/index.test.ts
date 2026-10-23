import { describe, it, expect } from 'vitest';
import { migrations } from './index';

/**
 * Guards on the migration REGISTRY, not on the SQL.
 *
 * Be clear about the limit: these tests cannot tell whether the SQL is valid
 * Postgres. That is only answered by applying it to a real server, which
 * happens at deploy — I have a database on DP600 but deliberately never hold
 * its password, so I cannot connect from here to check. Saying so is the point;
 * a green suite here must not be read as "the schema is correct".
 *
 * What these DO catch is the registry going wrong in ways that are silent at
 * deploy time: a version reused, a gap, an empty migration.
 */
describe('migration registry', () => {
  it('is not empty', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it('has unique versions', () => {
    const versions = migrations.map((m) => m.version);

    expect(new Set(versions).size).toBe(versions.length);
  });

  /**
   * Contiguous from 1. A gap means a migration was deleted after being written,
   * so environments that already applied it disagree with ones that never saw
   * it — and nothing would report the difference.
   */
  it('has contiguous versions starting at 1', () => {
    const versions = migrations.map((m) => m.version).sort((a, b) => a - b);

    expect(versions).toEqual(versions.map((_, index) => index + 1));
  });

  it('gives every migration a name and non-empty sql', () => {
    for (const migration of migrations) {
      expect(migration.name, `migration ${migration.version} name`).toBeTruthy();
      expect(migration.sql.trim(), `migration ${migration.version} sql`).not.toBe('');
    }
  });

  /**
   * The offline queue retries as its normal path, so this constraint is what
   * makes a retried fuel fill safe rather than duplicated. It is load-bearing
   * for the measurement the project exists to produce, so it gets a guard
   * against being quietly edited out.
   */
  it.each(['fuel_fills', 'gauge_readings'])(
    'declares client_uuid UNIQUE on %s, which the offline queue depends on',
    (table) => {
      const initial = migrations.find((m) => m.version === 1);
      const tableBlock = initial?.sql.split(`CREATE TABLE ${table} (`)[1]?.split(');')[0];

      expect(tableBlock, `${table} block not found in migration 001`).toBeDefined();
      expect(tableBlock).toMatch(/client_uuid\s+UUID\s+UNIQUE/i);
    },
  );
});
