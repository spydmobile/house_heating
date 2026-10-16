/**
 * Fail-fast server configuration.
 *
 * The environment is an ARGUMENT, not an ambient fact read from `process.env`
 * inside this module. That is what makes the failure testable without mutating
 * global state, and it keeps the dependency pointing inward: the caller at the
 * edge of the system supplies the environment.
 *
 * No defaults. A required variable that is absent throws, and the error names
 * the variable. A silent default would let the server start and fail later with
 * a message that does not name the cause.
 */

export interface ServerConfig {
  port: string;
  database: {
    host: string;
    port: string;
    name: string;
    user: string;
    password: string;
  };
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];

  if (!value) {
    throw new Error(
      `Required environment variable ${name} is not set. ` +
        'Set it explicitly — this server has no defaults for required configuration.',
    );
  }

  return value;
}

export function loadServerConfig(env: Env): ServerConfig {
  return {
    port: required(env, 'PORT'),
    database: {
      host: required(env, 'DB_HOST'),
      port: required(env, 'DB_PORT'),
      name: required(env, 'DB_NAME'),
      user: required(env, 'DB_USER'),
      password: required(env, 'HOUSE_HEATING_PASSWORD'),
    },
  };
}
