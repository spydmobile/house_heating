/*
 * SpyD Home Heat — service worker.
 *
 * Hand-written rather than generated, because the caching rules here are
 * load-bearing and a generated config would hide them.
 *
 * SERVED FROM THE SITE ROOT, UNHASHED, with `no-store`. Both matter:
 *   - at the root so its scope is `/` and it controls the whole app;
 *   - unhashed and uncached because a CACHED SERVICE WORKER IS THE ONE FILE A
 *     LATER DEPLOY CANNOT FIX. The browser asks the old worker whether to
 *     update, and the old worker answers.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: Background Sync. Safari does not
 * implement it, so a queue flushed from a `sync` event would work perfectly in
 * desktop Chrome and silently lose fuel fills on the one device that matters.
 * Queue flushing lives in the app (src/offline/OfflineQueue.ts) and runs on app
 * open and on regained connectivity.
 */

const VERSION = 'v1';
const SHELL_CACHE = `shell-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;

/* The shell is the minimum needed to render offline at the oil tank. */
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);

      /*
       * Added individually. `cache.addAll` rejects the whole install if ANY
       * single URL fails, which would leave the app with no worker at all
       * because one file 404'd.
       */
      await Promise.all(
        SHELL_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch {
            /* One missing shell URL must not abort the install. */
          }
        }),
      );

      /* Take over at the next load rather than waiting for every tab to close. */
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const names = await caches.keys();

      await Promise.all(
        names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)),
      );

      await self.clients.claim();
    })(),
  );
});

/* Is this a page navigation rather than a sub-resource request? */
function isNavigation(request) {
  return (
    request.mode === 'navigate' ||
    (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'))
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  /* Cross-origin requests are left entirely alone. */
  if (url.origin !== self.location.origin) return;

  /*
   * THE API IS NEVER CACHED, in either direction.
   *
   * Reading a stale fill or a stale gauge level and presenting it as current
   * would be worse than showing nothing. And caching a RESPONSE to /api/*
   * risks storing an HTML error page as if it were JSON, which then outlives
   * the deploy that caused it — the app keeps parsing a page where it expects
   * data until someone clears site data on the phone.
   *
   * Writes are not retried here either: the app's own queue owns that, because
   * it is what mints the stable client_uuid the server upserts on.
   */
  if (url.pathname.startsWith('/api/')) return;

  /* Never serve the worker itself from cache. */
  if (url.pathname === '/sw.js') return;

  if (request.method !== 'GET') return;

  /*
   * Navigations: network first, cached shell as the fallback. Network-first so
   * a deploy is picked up on the next load with a connection; the fallback is
   * what makes the app open at all at the tank.
   */
  if (isNavigation(request)) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);

          if (response && response.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put('/index.html', response.clone());
          }

          return response;
        } catch {
          const cached =
            (await caches.match('/index.html')) || (await caches.match('/'));

          if (cached) return cached;

          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
              '<p>SpyD Home Heat is offline and has no cached copy yet. ' +
              'Open it once with a connection.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          );
        }
      })(),
    );
    return;
  }

  /*
   * Static assets: cache first, refreshed in the background.
   *
   * Safe because Vite content-hashes everything under /assets/ — a changed
   * file is a different URL, so a cached one can never be stale. The
   * background refresh covers the unhashed files (icons, manifest).
   */
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);

      const network = fetch(request)
        .then(async (response) => {
          if (response && response.ok) {
            const cache = await caches.open(ASSET_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => undefined);

      /* Cached wins immediately; the network copy lands for next time. */
      const response = cached || (await network);

      if (response) return response;

      return new Response('', { status: 504, statusText: 'Offline' });
    })(),
  );
});

/*
 * The page tells the worker to activate immediately after an update, so a
 * deploy does not wait for every tab to be closed.
 */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
