import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env from parent directory (where .env lives)
  const env = loadEnv(mode, process.cwd() + '/..', '')
  const apiPort = env.PORT || 'ENV_PORT_NOT_SET'

  return {
    plugins: [react()],
    server: {
      port: parseInt(env.VITE_DEV_PORT || 'ENV_VITE_DEV_PORT_NOT_SET', 10),
    },
    // Pass API port to client code (avoids redundant VITE_API_URL)
    define: {
      __API_PORT__: JSON.stringify(apiPort),
    },
  }
})
