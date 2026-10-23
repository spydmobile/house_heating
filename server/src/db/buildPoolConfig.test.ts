import { describe, it, expect } from 'vitest';
import { buildPoolConfig } from './buildPoolConfig';
import type { ServerConfig } from '../config/loadServerConfig';

function config(overrides: Partial<ServerConfig['database']> = {}): ServerConfig {
  return {
    port: '3008',
    database: {
      host: 'postgres',
      port: '5432',
      name: 'house_heating',
      user: 'house_heating',
      password: 'test-password-not-a-real-credential',
      ...overrides,
    },
  };
}

describe('buildPoolConfig', () => {
  it('maps the server config onto pg connection options', () => {
    const pool = buildPoolConfig(config());

    expect(pool.host).toBe('postgres');
    expect(pool.database).toBe('house_heating');
    expect(pool.user).toBe('house_heating');
  });

  /**
   * Environment variables are strings; `pg` wants a number for the port. Left
   * as a string it is coerced somewhere deeper, where a bad value stops being
   * traceable to DB_PORT.
   */
  it('converts the port to a number', () => {
    const pool = buildPoolConfig(config());

    expect(pool.port).toBe(5432);
    expect(typeof pool.port).toBe('number');
  });

  /**
   * Fail fast on a malformed port. `Number('abc')` is NaN, and NaN passed to a
   * connection attempt produces a failure that names neither the variable nor
   * the value — it looks like the database is down.
   */
  it.each(['abc', '', '  ', '54a32'])(
    'throws, naming DB_PORT, when the port is %o rather than a number',
    (badPort) => {
      expect(() => buildPoolConfig(config({ port: badPort }))).toThrowError(/DB_PORT/);
    },
  );

  it('rejects a port outside the valid TCP range', () => {
    expect(() => buildPoolConfig(config({ port: '0' }))).toThrowError(/DB_PORT/);
    expect(() => buildPoolConfig(config({ port: '70000' }))).toThrowError(/DB_PORT/);
  });

  /**
   * POSITIVE CONTROL for the two tests above: a valid non-default port must be
   * accepted, or "rejects bad ports" could be satisfied by rejecting all of them.
   */
  it('accepts a valid non-default port', () => {
    expect(buildPoolConfig(config({ port: '55432' })).port).toBe(55432);
  });
});
