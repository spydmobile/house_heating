import { describe, it, expect } from 'vitest';
import { createLocalStorageQueueStorage } from './localStorageQueueStorage';
import type { QueuedRequest } from './OfflineQueue';

/** Minimal in-memory Storage, so these run without a DOM. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));

  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

/** Throws on write, as Safari private mode does. */
function readOnlyStorage(): Storage {
  return {
    ...memoryStorage(),
    setItem() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  } as Storage;
}

const request: QueuedRequest = {
  url: '/api/fills',
  body: { client_uuid: '11111111-2222-3333-4444-555555555555', liters_added: 511.7 },
  queuedAt: 1_770_000_000_000,
};

describe('localStorageQueueStorage', () => {
  it('reads an empty queue when nothing has been stored', async () => {
    const storage = createLocalStorageQueueStorage(memoryStorage());

    expect(await storage.read()).toEqual([]);
  });

  it('round-trips queued requests', async () => {
    const storage = createLocalStorageQueueStorage(memoryStorage());

    await storage.write([request]);

    expect(await storage.read()).toEqual([request]);
  });

  /**
   * A corrupt value must NOT be read as an empty queue. Treating it as empty
   * would silently discard fills that are sitting right there in storage, and
   * the person who logged them would never find out.
   */
  it('throws on corrupt JSON rather than reporting an empty queue', async () => {
    const storage = createLocalStorageQueueStorage(
      memoryStorage({ 'spyd-home-heat.offline-queue.v1': '{not json' }),
    );

    await expect(storage.read()).rejects.toThrow(/valid JSON/i);
  });

  it('throws when the stored value is not an array', async () => {
    const storage = createLocalStorageQueueStorage(
      memoryStorage({ 'spyd-home-heat.offline-queue.v1': '{"a":1}' }),
    );

    await expect(storage.read()).rejects.toThrow(/array/i);
  });

  /**
   * A failed write must propagate. Reporting a fill as queued when storage
   * refused it is the one outcome worse than an error at the tank.
   */
  it('propagates a storage write failure instead of swallowing it', async () => {
    const storage = createLocalStorageQueueStorage(readOnlyStorage());

    await expect(storage.write([request])).rejects.toThrow();
  });
});
