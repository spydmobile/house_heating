import type { QueueStorage, QueuedRequest } from './OfflineQueue';

/**
 * Browser-storage backing for the offline queue.
 *
 * localStorage rather than IndexedDB, deliberately: the queue holds a handful
 * of small records and localStorage is synchronous and has no open/upgrade
 * dance to get wrong. The async `QueueStorage` interface means this can be
 * swapped for IndexedDB later without touching the queue's rules.
 *
 * NOTHING HERE IS SWALLOWED. Safari in private mode throws on write, and some
 * browsers throw on read when site data is blocked. A queue that silently
 * dropped a fuel fill while telling Franco it was saved is worse than one that
 * refuses — he is standing at the tank in the cold, and the only thing worse
 * than an error is a false success.
 *
 * iOS also evicts this storage after roughly seven days of non-use. That is
 * why `queuedAt` exists on each item and why the UI shows pending items
 * rather than hiding them: an invisible queued fill can disappear with nobody
 * learning it never landed.
 */

const STORAGE_KEY = 'spyd-home-heat.offline-queue.v1';

function parse(raw: string | null): QueuedRequest[] {
  if (raw === null) return [];

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt JSON. Returning [] here would DISCARD queued fills silently, so
    // it throws instead and the caller surfaces it.
    throw new Error(
      'The offline queue in browser storage is not valid JSON. Refusing to ' +
        'treat it as empty, because that would discard queued records.',
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error('The offline queue in browser storage is not an array.');
  }

  return parsed as QueuedRequest[];
}

export function createLocalStorageQueueStorage(
  storage: Storage = window.localStorage,
): QueueStorage {
  return {
    async read() {
      return parse(storage.getItem(STORAGE_KEY));
    },

    async write(items: QueuedRequest[]) {
      // A QuotaExceededError or a private-mode SecurityError propagates. The
      // caller must learn the write did not happen.
      storage.setItem(STORAGE_KEY, JSON.stringify(items));
    },
  };
}
