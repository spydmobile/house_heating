/**
 * Queue for writes made while the server is unreachable.
 *
 * `*.home.spyd.com` is a Tailscale address, so the server exists only on the
 * tailnet or the lab LAN. The primary use case — logging a fuel fill at the oil
 * tank, outside, in a Fort Smith winter — happens where there is no route to it
 * at all. So a write is accepted locally, queued, and flushed on the next app
 * open with connectivity.
 *
 * Deliberately NOT driven by the Background Sync API: Safari does not implement
 * it, so a `sync`-driven queue works in desktop Chrome and silently loses fills
 * on the one device that matters.
 *
 * Storage and UUID generation are injected so this logic is testable and so the
 * storage layer can be IndexedDB, localStorage, or anything else without
 * touching the queue's rules.
 */

export interface QueuedRequest {
  url: string;
  body: Record<string, unknown>;
  /** Epoch ms at enqueue. Lets the UI show an item as stale, which matters
   *  because iOS evicts service-worker storage after ~7 days of non-use. */
  queuedAt: number;
}

export interface QueueStorage {
  read(): Promise<QueuedRequest[]>;
  write(items: QueuedRequest[]): Promise<void>;
}

export interface SendResult {
  ok: boolean;
  /** HTTP status when there was a response at all. Absent means no response. */
  status?: number;
}

export type Sender = (request: QueuedRequest) => Promise<SendResult>;

export interface FlushResult {
  /** Accepted by the server. */
  sent: number;
  /** Not delivered — no network, or a server error. Still queued. */
  failed: number;
  /** Refused as invalid (4xx). Dropped, because retrying cannot help. */
  rejected: number;
}

export class OfflineQueue {
  // Explicit fields rather than constructor parameter properties: this client
  // builds with `erasableSyntaxOnly`, which forbids the shorthand because it
  // emits runtime code from a type-position annotation. vitest runs through
  // esbuild and does not enforce it, so the real build is what catches this.
  private readonly storage: QueueStorage;
  private readonly newUuid: () => string;

  constructor(
    storage: QueueStorage,
    newUuid: () => string = () => crypto.randomUUID(),
  ) {
    this.storage = storage;
    this.newUuid = newUuid;
  }

  async pending(): Promise<QueuedRequest[]> {
    return this.storage.read();
  }

  /**
   * The uuid is minted HERE, once, and carried in the body for the server's
   * ON CONFLICT (client_uuid) to recognise a retry.
   *
   * Generating it at send time instead would look equivalent and would break
   * duplicate protection completely: every retry would carry a new uuid, the
   * upsert would never fire, and a flaky connection at the tank would add
   * duplicate fills to the history the window-ROI is computed from.
   *
   * Errors are NOT swallowed. If storage threw — Safari private mode, a browser
   * blocking site data — the caller must learn the fill was not kept, rather
   * than being told it is safely queued when nothing was written.
   */
  async enqueue(url: string, body: Record<string, unknown>): Promise<QueuedRequest> {
    const request: QueuedRequest = {
      url,
      body: {
        ...body,
        client_uuid: body.client_uuid ?? this.newUuid(),
      },
      queuedAt: Date.now(),
    };

    const items = await this.storage.read();
    await this.storage.write([...items, request]);

    return request;
  }

  /**
   * Attempts each queued request in order, oldest first.
   *
   * Order is preserved across failures: a gauge reading taken before a fill but
   * flushed after it would describe a tank state that never existed.
   *
   * A 4xx is dropped — the server refused the content and no number of retries
   * changes that, while leaving it queued would block everything behind it
   * forever. Anything else stays queued.
   */
  async flush(send: Sender): Promise<FlushResult> {
    const items = await this.storage.read();

    if (items.length === 0) {
      return { sent: 0, failed: 0, rejected: 0 };
    }

    const remaining: QueuedRequest[] = [];
    let sent = 0;
    let failed = 0;
    let rejected = 0;

    for (const request of items) {
      try {
        const result = await send(request);

        if (result.ok) {
          sent += 1;
          continue;
        }

        if (result.status !== undefined && result.status >= 400 && result.status < 500) {
          rejected += 1;
          continue;
        }

        failed += 1;
        remaining.push(request);
      } catch {
        // No response at all — almost always "there is no network here".
        failed += 1;
        remaining.push(request);
      }
    }

    await this.storage.write(remaining);

    return { sent, failed, rejected };
  }
}
