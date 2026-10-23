import { describe, it, expect, beforeEach } from 'vitest';
import { OfflineQueue, type QueueStorage, type QueuedRequest } from './OfflineQueue';

/**
 * The offline queue is the whole reason this app is a PWA.
 *
 * `*.home.spyd.com` resolves to a Tailscale address, so the server is reachable
 * on the tailnet or the lab LAN and NOWHERE ELSE. The primary use case is
 * logging a fuel fill standing at the oil tank, outside, in Fort Smith in
 * winter — where there is no route to the server at all. So the app accepts the
 * fill, queues it, and flushes later.
 *
 * Three facts shape every test below:
 *
 * 1. iOS has NO Background Sync API. A queue that flushes on a `sync` event
 *    works perfectly in desktop Chrome and silently loses fills on his iPhone.
 *    Flushing is therefore driven by app open / regained connectivity.
 * 2. iOS evicts service-worker storage after ~7 days of non-use, so a queued
 *    item must be VISIBLE as pending — otherwise it can vanish and nobody
 *    learns it never landed.
 * 3. The server upserts on a client-generated UUID. That only protects anything
 *    if the UUID is minted ONCE, at enqueue, and reused on every retry.
 */

function memoryStorage(initial: QueuedRequest[] = []): QueueStorage {
  let items = [...initial];

  return {
    async read() {
      return [...items];
    },
    async write(next) {
      items = [...next];
    },
  };
}

/** Throws on read/write, as Safari private mode and a storage-blocked browser do. */
function hostileStorage(): QueueStorage {
  return {
    async read(): Promise<QueuedRequest[]> {
      throw new Error('The operation is insecure.');
    },
    async write(): Promise<void> {
      throw new Error('The operation is insecure.');
    },
  };
}

const fill = {
  date: '2026-02-24',
  gauge_percent_before: 12.5,
  liters_added: 511.7,
  price_per_liter: 1.459,
};

let uuidCounter: number;

function stubUuid(): string {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-00000000000${uuidCounter}`;
}

beforeEach(() => {
  uuidCounter = 0;
});

describe('OfflineQueue', () => {
  describe('enqueue', () => {
    it('stores a request and reports it as pending', async () => {
      const queue = new OfflineQueue(memoryStorage(), stubUuid);

      await queue.enqueue('/api/fills', fill);

      const pending = await queue.pending();

      expect(pending).toHaveLength(1);
      expect(pending[0].url).toBe('/api/fills');
    });

    /**
     * The UUID is minted HERE, once, and travels in the body — so the server's
     * ON CONFLICT (client_uuid) can recognise a retry. If it were generated at
     * send time instead, every retry would carry a new uuid, the upsert would
     * never fire, and a flaky connection at the tank would produce duplicate
     * fills in the history the ROI is computed from.
     */
    it('mints a client_uuid at enqueue and puts it in the body', async () => {
      const queue = new OfflineQueue(memoryStorage(), stubUuid);

      await queue.enqueue('/api/fills', fill);

      const [queued] = await queue.pending();

      expect(queued.body.client_uuid).toBe('00000000-0000-4000-8000-000000000001');
    });

    it('does not overwrite a client_uuid the caller already chose', async () => {
      const queue = new OfflineQueue(memoryStorage(), stubUuid);

      await queue.enqueue('/api/fills', {
        ...fill,
        client_uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      });

      const [queued] = await queue.pending();

      expect(queued.body.client_uuid).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    });

    it('records when the item was queued, so a stale item can be shown as stale', async () => {
      const queue = new OfflineQueue(memoryStorage(), stubUuid);

      await queue.enqueue('/api/fills', fill);

      const [queued] = await queue.pending();

      expect(typeof queued.queuedAt).toBe('number');
      expect(queued.queuedAt).toBeGreaterThan(0);
    });

    /**
     * Storage can throw outright — Safari private mode, a browser set to block
     * site data. Accepting the fill into a store that threw would tell Franco
     * it is safely queued when nothing was written. It must fail loudly.
     */
    it('rejects rather than silently losing the fill when storage is unavailable', async () => {
      const queue = new OfflineQueue(hostileStorage(), stubUuid);

      await expect(queue.enqueue('/api/fills', fill)).rejects.toThrow();
    });
  });

  describe('flush', () => {
    it('sends each pending request and clears the ones that succeeded', async () => {
      const queue = new OfflineQueue(memoryStorage(), stubUuid);
      await queue.enqueue('/api/fills', fill);
      await queue.enqueue('/api/readings', { date: '2026-02-25', gauge_percent: 90 });

      const sent: string[] = [];
      const result = await queue.flush(async (request) => {
        sent.push(request.url);
        return { ok: true };
      });

      expect(sent).toEqual(['/api/fills', '/api/readings']);
      expect(result.sent).toBe(2);
      expect(await queue.pending()).toHaveLength(0);
    });

    it('keeps a request that failed to send so it can be retried', async () => {
      const queue = new OfflineQueue(memoryStorage(), stubUuid);
      await queue.enqueue('/api/fills', fill);

      const result = await queue.flush(async () => {
        throw new Error('Failed to fetch');
      });

      expect(result.sent).toBe(0);
      expect(result.failed).toBe(1);
      expect(await queue.pending()).toHaveLength(1);
    });

    /**
     * A retry must carry the SAME uuid it was queued with. This is the test
     * that would catch a refactor moving uuid generation to send time, which
     * would look harmless and quietly break duplicate protection.
     */
    it('retries with the same client_uuid it was queued with', async () => {
      const queue = new OfflineQueue(memoryStorage(), stubUuid);
      await queue.enqueue('/api/fills', fill);

      const seen: string[] = [];
      const failOnce = async (request: QueuedRequest) => {
        seen.push(request.body.client_uuid as string);
        throw new Error('Failed to fetch');
      };

      await queue.flush(failOnce);
      await queue.flush(failOnce);

      expect(seen).toHaveLength(2);
      expect(seen[0]).toBe(seen[1]);
    });

    /**
     * A 4xx is the server REFUSING the request — a malformed body, say. Retrying
     * it forever cannot succeed, and it would block everything queued behind it
     * indefinitely. It is dropped from the queue and reported, so it surfaces
     * rather than silently cycling.
     */
    it('drops a request the server rejected as invalid rather than retrying it forever', async () => {
      const queue = new OfflineQueue(memoryStorage(), stubUuid);
      await queue.enqueue('/api/fills', fill);

      const result = await queue.flush(async () => ({ ok: false, status: 400 }));

      expect(result.rejected).toBe(1);
      expect(await queue.pending()).toHaveLength(0);
    });

    it('keeps a request after a server error, which is worth retrying', async () => {
      const queue = new OfflineQueue(memoryStorage(), stubUuid);
      await queue.enqueue('/api/fills', fill);

      const result = await queue.flush(async () => ({ ok: false, status: 503 }));

      expect(result.failed).toBe(1);
      expect(await queue.pending()).toHaveLength(1);
    });

    /**
     * Order matters: a gauge reading taken before a fill, flushed after it,
     * describes a tank state that never existed. FIFO, and one failure must not
     * reorder what is behind it.
     */
    it('preserves queue order across a partial failure', async () => {
      const queue = new OfflineQueue(memoryStorage(), stubUuid);
      await queue.enqueue('/api/fills', { ...fill, marker: 'first' });
      await queue.enqueue('/api/fills', { ...fill, marker: 'second' });

      let attempt = 0;
      await queue.flush(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('Failed to fetch');
        return { ok: true };
      });

      const remaining = await queue.pending();

      expect(remaining).toHaveLength(1);
      expect(remaining[0].body.marker).toBe('first');
    });

    it('is a no-op on an empty queue', async () => {
      const queue = new OfflineQueue(memoryStorage(), stubUuid);

      const result = await queue.flush(async () => ({ ok: true }));

      expect(result).toEqual({ sent: 0, failed: 0, rejected: 0 });
    });
  });
});
