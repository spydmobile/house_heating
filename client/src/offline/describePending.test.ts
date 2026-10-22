import { describe, it, expect } from 'vitest';
import { describePending, STALE_AFTER_DAYS } from './describePending';
import type { QueuedRequest } from './OfflineQueue';

/**
 * What the pending banner says.
 *
 * It exists because iOS evicts service-worker storage after roughly seven days
 * of non-use. A queued fuel fill that is never shown can vanish with nobody
 * learning it never landed — so the UI has to say, plainly, that something is
 * waiting and how long it has been waiting.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 1, 25, 12, 0, 0);

function queued(url: string, daysAgo: number): QueuedRequest {
  return {
    url,
    body: { client_uuid: '11111111-2222-3333-4444-555555555555' },
    queuedAt: now - daysAgo * DAY_MS,
  };
}

describe('describePending', () => {
  it('says nothing is waiting when the queue is empty', () => {
    const state = describePending([], now);

    expect(state.count).toBe(0);
    expect(state.visible).toBe(false);
  });

  it('becomes visible as soon as anything is queued', () => {
    const state = describePending([queued('/fills', 0)], now);

    expect(state.visible).toBe(true);
    expect(state.count).toBe(1);
  });

  it('names what is waiting, in plain words rather than paths', () => {
    const state = describePending([queued('/fills', 0), queued('/readings', 0)], now);

    expect(state.summary).toMatch(/1 fuel fill/i);
    expect(state.summary).toMatch(/1 gauge reading/i);
  });

  it('pluralises correctly', () => {
    const state = describePending([queued('/fills', 0), queued('/fills', 0)], now);

    expect(state.summary).toMatch(/2 fuel fills/i);
  });

  /**
   * THE REASON THIS MODULE EXISTS. Past the eviction window the warning has to
   * change from "waiting" to "at risk", because that is the point at which iOS
   * may discard it.
   */
  it('escalates to a warning once an item is older than the eviction window', () => {
    const fresh = describePending([queued('/fills', 1)], now);
    const stale = describePending([queued('/fills', STALE_AFTER_DAYS + 1)], now);

    expect(fresh.stale).toBe(false);
    expect(stale.stale).toBe(true);
    expect(stale.summary).toMatch(/\b\d+ days?\b/);
  });

  it('reports the age of the OLDEST item, not the newest', () => {
    const state = describePending([queued('/fills', 9), queued('/readings', 0)], now);

    expect(state.oldestDays).toBe(9);
    expect(state.stale).toBe(true);
  });

  /**
   * An item queued moments ago is 0 days old, not "1 day". Rounding up would
   * make every fresh fill look as though it had been stuck overnight.
   */
  it('reports a just-queued item as zero days old', () => {
    expect(describePending([queued('/fills', 0)], now).oldestDays).toBe(0);
  });

  it('describes an unrecognised path without inventing a name for it', () => {
    const state = describePending([queued('/something-new', 0)], now);

    expect(state.visible).toBe(true);
    expect(state.summary).toMatch(/1 item/i);
  });
});
