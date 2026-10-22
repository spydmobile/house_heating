import type { QueuedRequest } from './OfflineQueue';

/**
 * Turns the queue into something the UI can say out loud.
 *
 * This exists because of one platform fact: iOS evicts service-worker storage
 * after roughly seven days of non-use. A queued fuel fill that is never
 * displayed can simply disappear, and nobody learns it never landed — the
 * history just has a hole in it, in the series the window-replacement ROI is
 * computed from.
 *
 * So pending items are shown, always, and once one is older than the eviction
 * window the wording escalates from "waiting" to "at risk".
 */

/** iOS clears unused site storage at roughly this age. */
export const STALE_AFTER_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Plain-English names. A path is not something to show a person. */
const LABELS: Record<string, { one: string; many: string }> = {
  '/fills': { one: 'fuel fill', many: 'fuel fills' },
  '/readings': { one: 'gauge reading', many: 'gauge readings' },
  '/weather': { one: 'weather day', many: 'weather days' },
  '/hvac': { one: 'HVAC report', many: 'HVAC reports' },
};

export interface PendingState {
  visible: boolean;
  count: number;
  /** Age of the OLDEST item — the one at risk of eviction. */
  oldestDays: number;
  stale: boolean;
  summary: string;
}

function label(url: string, count: number): string {
  const known = LABELS[url];

  // An unrecognised path is described as "item" rather than guessed at. A made
  // up name would be worse than a vague one.
  if (!known) return `${count} ${count === 1 ? 'item' : 'items'}`;

  return `${count} ${count === 1 ? known.one : known.many}`;
}

export function describePending(
  pending: QueuedRequest[],
  now: number = Date.now(),
): PendingState {
  if (pending.length === 0) {
    return { visible: false, count: 0, oldestDays: 0, stale: false, summary: '' };
  }

  const byUrl = new Map<string, number>();

  for (const request of pending) {
    byUrl.set(request.url, (byUrl.get(request.url) ?? 0) + 1);
  }

  const parts = [...byUrl.entries()].map(([url, count]) => label(url, count));

  // Floored, not rounded: something queued minutes ago is 0 days old, and
  // rounding up would make every fresh fill look stuck overnight.
  const oldestQueuedAt = Math.min(...pending.map((request) => request.queuedAt));
  const oldestDays = Math.max(0, Math.floor((now - oldestQueuedAt) / DAY_MS));
  const stale = oldestDays >= STALE_AFTER_DAYS;

  const waiting = parts.join(' and ');

  const summary = stale
    ? `${waiting} still waiting to send — the oldest is ${oldestDays} days old ` +
      'and may be discarded by the browser. Open this app somewhere with a ' +
      'connection to the server.'
    : `${waiting} waiting to send. ${
        oldestDays > 0 ? `Oldest ${oldestDays} days. ` : ''
      }They will go automatically when the server is reachable.`;

  return { visible: true, count: pending.length, oldestDays, stale, summary };
}
