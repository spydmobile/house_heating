import type { ServerConfig } from '../config/loadServerConfig';

/**
 * Translates validated configuration into `pg` connection options.
 *
 * Separate from `loadServerConfig` because that one's job is "is every required
 * variable present", and this one's is "is the value usable". A port of "abc" is
 * present and unusable, and the difference matters: `Number('abc')` is NaN, and
 * NaN reaching a connection attempt produces a failure that names neither the
 * variable nor the value. It looks exactly like the database being down, which
 * is the most expensive possible way to report a typo.
 *
 * The password passes through and is never logged or included in an error
 * message here.
 */

export interface PoolConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65535;

function parsePort(raw: string): number {
  // Number('') and Number('  ') are both 0, which would pass a NaN check and
  // then fail as an out-of-range port. Reject non-numeric text explicitly.
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(
      `DB_PORT must be a number, got ${JSON.stringify(raw)}. ` +
        'Left unchecked this surfaces as a connection failure that looks like ' +
        'the database being unreachable.',
    );
  }

  const port = Number(raw.trim());

  if (port < MIN_TCP_PORT || port > MAX_TCP_PORT) {
    throw new Error(
      `DB_PORT must be between ${MIN_TCP_PORT} and ${MAX_TCP_PORT}, got ${port}.`,
    );
  }

  return port;
}

export function buildPoolConfig(config: ServerConfig): PoolConfig {
  return {
    host: config.database.host,
    port: parsePort(config.database.port),
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
  };
}
