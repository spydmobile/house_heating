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
describe('loadServerConfig', () => {
  it('throws, naming PORT, when PORT is absent', () => {
    expect(() => loadServerConfig({})).toThrowError(/PORT/);
  });
});
