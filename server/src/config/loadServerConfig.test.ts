import { describe, it, expect } from 'vitest';
import { loadServerConfig } from './loadServerConfig';

/**
 * Fail-fast configuration.
 *
 * The existing `server/src/config.ts` does this:
 *
 *     port: process.env.PORT || 'ENV_PORT_NOT_SET'
 *
 * which is a silent default. A missing PORT does not stop the server; it starts
 * and then fails somewhere else with a message that does not name the cause.
 * Inside a container that is worse: a missing variable in compose yields a
 * service that looks up and is broken.
 *
 * `loadServerConfig` takes the environment as an argument rather than reading
 * `process.env` itself, so the failure can be tested without mutating global
 * state. The environment is an input, not an ambient fact.
 */

/**
 * A COMPLETE, valid environment. Every "missing variable" test starts from this
 * and removes exactly one, so each test names the one thing it is about and
 * cannot accidentally pass because something else was also absent.
 *
 * When a new variable becomes required, it is added here once and every test
 * stays honest. These are fixture values, not real credentials.
 */
function validEnv(): Record<string, string> {
  return {
    PORT: '3008',
    HOUSE_HEATING_PASSWORD: 'test-password-not-a-real-credential',
  };
}

function envWithout(name: string): Record<string, string | undefined> {
  const env = validEnv() as Record<string, string | undefined>;
  delete env[name];
  return env;
}

describe('loadServerConfig', () => {
  /**
   * POSITIVE CONTROL. Without this, an implementation that threw
   * unconditionally would pass every test below, and the suite could not tell
   * the difference between "rejects a missing variable" and "rejects
   * everything". A negative result is not a result until it has a control.
   */
  it('returns the configuration when every required variable is set', () => {
    const config = loadServerConfig(validEnv());

    expect(config.port).toBe('3008');
    expect(config.database.password).toBe('test-password-not-a-real-credential');
  });

  it('throws, naming PORT, when PORT is absent', () => {
    expect(() => loadServerConfig(envWithout('PORT'))).toThrowError(/PORT/);
  });

  /**
   * The database password arrives in the container env as
   * HOUSE_HEATING_PASSWORD, wired from the box's keychain-backed .env. The
   * value is never known here. A silent default would be worse than a missing
   * port: the server would start and connect somewhere unintended, or fail at
   * first query with an authentication error that does not name the cause.
   */
  it('throws, naming HOUSE_HEATING_PASSWORD, when the database password is absent', () => {
    expect(() => loadServerConfig(envWithout('HOUSE_HEATING_PASSWORD'))).toThrowError(
      /HOUSE_HEATING_PASSWORD/,
    );
  });

  /**
   * An empty string is absence wearing a disguise. `PORT=` in a compose file or
   * a .env is the most likely way this actually happens, and `||` would have
   * treated it as unset while a `!== undefined` check would treat it as set.
   */
  it('treats an empty string as absent rather than as a value', () => {
    const env = validEnv() as Record<string, string | undefined>;
    env.PORT = '';

    expect(() => loadServerConfig(env)).toThrowError(/PORT/);
  });
});
