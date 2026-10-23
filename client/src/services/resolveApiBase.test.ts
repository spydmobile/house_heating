import { describe, it, expect } from 'vitest';
import { resolveApiBase } from './resolveApiBase';

/**
 * Where the client sends its API calls.
 *
 * THE BUG THIS FIXES, and it would have broken the deploy outright:
 *
 *     const API_BASE = `http://localhost:${__API_PORT__}/api`;
 *
 * Hardcoded `localhost`. On a phone, localhost IS the phone — so every request
 * from the installed PWA would have gone nowhere. It works in development only
 * because the browser happens to be on the same machine as the server.
 *
 * In production the Express server serves the built client and the API from one
 * port behind one NPM proxy host, so the right answer is a same-origin relative
 * path. That also keeps working whatever hostname the app is reached by, which
 * matters here: it is served over the tailnet at heat.home.spyd.com, never at
 * localhost.
 */
describe('resolveApiBase', () => {
  it('is a same-origin relative path in production', () => {
    expect(resolveApiBase({ isProduction: true, apiPort: '' })).toBe('/api');
  });

  /**
   * Relative regardless of what port leaked into the build. A production bundle
   * must never contain an absolute host — that is the whole defect.
   */
  it('stays relative in production even if a port was injected', () => {
    expect(resolveApiBase({ isProduction: true, apiPort: '3008' })).toBe('/api');
  });

  it('targets the local API port in development, where the origins differ', () => {
    expect(resolveApiBase({ isProduction: false, apiPort: '3008' })).toBe(
      'http://localhost:3008/api',
    );
  });

  /**
   * Fail loudly at startup rather than issuing requests to a malformed URL.
   * `http://localhost:undefined/api` fails with a DNS-ish error that names
   * neither the variable nor the cause.
   */
  it.each(['', '   ', 'undefined', 'ENV_PORT_NOT_SET'])(
    'throws in development when the port is %o',
    (bad) => {
      expect(() => resolveApiBase({ isProduction: false, apiPort: bad })).toThrowError(
        /PORT/,
      );
    },
  );

  it('never produces a URL containing localhost in production', () => {
    expect(resolveApiBase({ isProduction: true, apiPort: '3008' })).not.toMatch(
      /localhost/,
    );
  });
});
