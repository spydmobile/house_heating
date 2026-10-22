"use strict";
/**
 * Versioned migration runner.
 *
 * Replaces `CREATE TABLE IF NOT EXISTS` on every boot, which can only create
 * something absent and cannot express a schema CHANGE.
 *
 * `MigrationClient` is a port declared by this module; `pg` is an adapter
 * supplied at the edge. Dependencies point inward — this file knows nothing
 * about `pg`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT        NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;
function assertNoDuplicateVersions(migrations) {
    const seen = new Set();
    for (const migration of migrations) {
        if (seen.has(migration.version)) {
            throw new Error(`Duplicate migration version ${migration.version} ` +
                `("${migration.name}"). Two migrations claiming one version means ` +
                'which runs depends on declaration order, which silently diverges ' +
                'schemas between environments.');
        }
        seen.add(migration.version);
    }
}
async function runMigrations(client, migrations) {
    // Before touching the database: a duplicate version is unrecoverable
    // ambiguity, not something to discover halfway through.
    assertNoDuplicateVersions(migrations);
    await client.query(MIGRATIONS_TABLE);
    const result = await client.query('SELECT version FROM schema_migrations;');
    const applied = new Set(result.rows.map((row) => Number(row.version)));
    const pending = migrations
        .filter((migration) => !applied.has(migration.version))
        .sort((a, b) => a.version - b.version);
    for (const migration of pending) {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2);', [migration.version, migration.name]);
    }
}
