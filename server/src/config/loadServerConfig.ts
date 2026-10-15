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
}

export function loadServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const port = env.PORT;

  if (!port) {
    throw new Error(
      'Required environment variable PORT is not set. ' +
        'Set it explicitly — this server has no default port.',
    );
  }

  return { port };
}
