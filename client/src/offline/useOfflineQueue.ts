import { useCallback, useEffect, useState } from 'react';
import { OfflineQueue, type QueuedRequest } from './OfflineQueue';
import { createLocalStorageQueueStorage } from './localStorageQueueStorage';
import { resolveApiBase } from '../services/resolveApiBase';

/**
 * Exposes the offline queue to the UI, and flushes it at the moments that
 * actually work on iOS.
 *
 * NOT Background Sync — Safari does not implement it, so a `sync`-driven flush
 * works perfectly in desktop Chrome and silently loses fuel fills on the one
 * device this app exists for. The triggers here are the ones iOS honours:
 *
 *   - mount (app open, including from the home screen)
 *   - `online`, when the tailnet comes back
 *   - `visibilitychange` to visible, which is what reopening a backgrounded PWA
 *     actually fires
 *
 * The pending list is surfaced DELIBERATELY rather than hidden. iOS evicts
 * service-worker storage after roughly seven days of non-use, so an invisible
 * queued fill can disappear with nobody ever learning it never landed.
 */

declare const __API_PORT__: string;
declare const __IS_PRODUCTION__: boolean;

const apiBase = resolveApiBase({
  isProduction: __IS_PRODUCTION__,
  apiPort: __API_PORT__,
});

const queue = new OfflineQueue(createLocalStorageQueueStorage());

export interface OfflineQueueState {
  pending: QueuedRequest[];
  /** A storage fault — the queue could not be read. Surfaced, never swallowed. */
  error: string | null;
  enqueue: (path: string, body: Record<string, unknown>) => Promise<void>;
  flush: () => Promise<void>;
}

export function useOfflineQueue(): OfflineQueueState {
  const [pending, setPending] = useState<QueuedRequest[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPending(await queue.pending());
      setError(null);
    } catch (cause) {
      // A corrupt or unreadable queue is reported. Showing an empty list would
      // say "nothing is waiting" when the truth is "I cannot tell".
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const flush = useCallback(async () => {
    try {
      await queue.flush(async (request) => {
        const response = await fetch(`${apiBase}${request.url}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request.body),
        });

        return { ok: response.ok, status: response.status };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      await refresh();
    }
  }, [refresh]);

  const enqueue = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      // Throws if storage refused. The caller must not tell Franco a fill is
      // safely queued when nothing was written.
      await queue.enqueue(path, body);
      await refresh();
      await flush();
    },
    [refresh, flush],
  );

  useEffect(() => {
    void flush();

    const onOnline = () => void flush();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void flush();
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [flush]);

  return { pending, error, enqueue, flush };
}
