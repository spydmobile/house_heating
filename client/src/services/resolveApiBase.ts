/**
 * Decides where the client sends its API calls.
 *
 * Replaces a hardcoded `http://localhost:${port}/api`, which would have broken
 * the deploy completely: on a phone, `localhost` is the phone. It only ever
 * worked because development runs the browser on the same machine as the
 * server.
 *
 * In production the Express server serves the built client and the API from a
 * single port behind one NPM proxy host, so a same-origin relative path is both
 * correct and hostname-independent — which matters when the app is reached at
 * heat.home.spyd.com over the tailnet rather than at localhost.
 */

export interface ApiBaseOptions {
  isProduction: boolean;
  apiPort: string;
}

/** Values that are present but mean "nobody set this". */
const NON_VALUES = new Set(['', 'undefined', 'null', 'NaN', 'ENV_PORT_NOT_SET']);

export function resolveApiBase({ isProduction, apiPort }: ApiBaseOptions): string {
  // Relative in production regardless of what was injected. A production
  // bundle must never carry an absolute host — that is the defect being fixed,
  // so it is closed off here rather than depending on the build being right.
  if (isProduction) return '/api';

  const port = apiPort.trim();

  if (NON_VALUES.has(port)) {
    throw new Error(
      'PORT is not set, so the development API base URL cannot be built. ' +
        'Set PORT in the .env at the repository root — see .env.example. ' +
        'Without this the app would request http://localhost:undefined/api and ' +
        'fail with an error naming neither the variable nor the cause.',
    );
  }

  return `http://localhost:${port}/api`;
}
