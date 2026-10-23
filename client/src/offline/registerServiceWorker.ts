/**
 * Registers the service worker and keeps it fresh.
 *
 * Registered from `/sw.js` at the site root so its scope is `/` and it controls
 * the whole app. The file is served unhashed with `no-store` — a cached service
 * worker is the one file a later deploy cannot fix, because the browser asks
 * the old worker whether to update and the old worker answers.
 *
 * Registration is deliberately NOT fatal. A browser with service workers
 * disabled, or a context that is not secure, still gets a working online app —
 * it just loses offline capability. What it must not do is fail to start.
 */

export interface RegisterOptions {
  /** Called when an updated worker is waiting, so the UI can offer a reload. */
  onUpdateReady?: () => void;
}

export async function registerServiceWorker({
  onUpdateReady,
}: RegisterOptions = {}): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  // A service worker only registers in a secure context. On DP600 that is
  // satisfied by the Let's Encrypt wildcard on *.home.spyd.com — which matters
  // because iOS refuses SILENTLY behind an untrusted certificate.
  if (!window.isSecureContext) return null;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;

      installing.addEventListener('statechange', () => {
        // `controller` is null on the very first install; an update is only an
        // update when something was already controlling the page.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          onUpdateReady?.();
        }
      });
    });

    return registration;
  } catch (error) {
    // Logged, not thrown: losing offline support must not stop the app.
    console.warn('[house-heating] service worker registration failed:', error);
    return null;
  }
}

/** Tells a waiting worker to take over now rather than at the next cold start. */
export function activateWaitingWorker(registration: ServiceWorkerRegistration): void {
  registration.waiting?.postMessage('SKIP_WAITING');
}
