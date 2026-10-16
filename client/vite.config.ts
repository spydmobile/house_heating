import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Fail-fast configuration, matching the server's rule.
 *
 * This file previously did:
 *
 *     const apiPort = env.PORT || 'ENV_PORT_NOT_SET'
 *     port: parseInt(env.VITE_DEV_PORT || 'ENV_VITE_DEV_PORT_NOT_SET', 10)
 *
 * Both are silent defaults. The first compiles the literal string
 * 'ENV_PORT_NOT_SET' into the client bundle, so a missing PORT produces a built
 * app whose API calls go to a nonsense host — found in the browser rather than
 * at build time. The second hands a non-numeric string to parseInt, which is
 * NaN, and a dev server then listens on an arbitrary port.
 *
 * A build is the right place to crash. Shipping a bundle that is wrong in a way
 * nobody sees until runtime is worse than not shipping one.
 *
 * In PRODUCTION there is no separate API origin to configure: Express serves
 * the built client and the API from one port behind one proxy host, so the
 * client uses same-origin relative URLs. PORT is only needed to cross origins
 * in development.
 */
function required(env: Record<string, string>, name: string, mode: string): string {
  const value = env[name]

  if (!value) {
    throw new Error(
      `[vite] Required environment variable ${name} is not set (mode: ${mode}). ` +
        'Set it in the .env at the repository root — this build has no defaults. ' +
        'See .env.example.',
    )
  }

  return value
}

function requiredPort(env: Record<string, string>, name: string, mode: string): number {
  const raw = required(env, name, mode)

  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`[vite] ${name} must be a number, got ${JSON.stringify(raw)}.`)
  }

  const port = Number(raw.trim())

  if (port < 1 || port > 65535) {
    throw new Error(`[vite] ${name} must be between 1 and 65535, got ${port}.`)
  }

  return port
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env from the parent directory, where .env lives.
  const env = loadEnv(mode, process.cwd() + '/..', '')

  const isProduction = mode === 'production'

  return {
    plugins: [react()],

    server: {
      port: requiredPort(env, 'VITE_DEV_PORT', mode),
    },

    define: {
      // Empty in production: the server serves the client and the API from the
      // same origin, so the client builds relative URLs and needs no port.
      // Required in development, where they are separate origins.
      __API_PORT__: JSON.stringify(isProduction ? '' : required(env, 'PORT', mode)),
      __IS_PRODUCTION__: JSON.stringify(isProduction),
    },
  }
})
