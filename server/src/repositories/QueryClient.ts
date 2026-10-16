/**
 * The port every repository talks to.
 *
 * Declared here, by the inner layer, and satisfied by a `pg` Pool at the edge.
 * Dependencies point inward: no repository imports `pg`, which is what lets the
 * repositories be tested without a database and what would let the driver be
 * replaced without touching business logic.
 */
export interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}
