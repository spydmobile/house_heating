import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './offline/registerServiceWorker'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Registered AFTER render, and never fatal: a browser with service workers
// disabled, or an insecure context, still gets a working online app — it just
// loses offline capability. Failing to start would be a far worse trade.
void registerServiceWorker({
  onUpdateReady: () => {
    console.info('[house-heating] a new version is ready; it loads on next open')
  },
})
