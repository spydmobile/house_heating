import { describePending } from '../offline/describePending';
import type { QueuedRequest } from '../offline/OfflineQueue';

/**
 * Shows what is still waiting to reach the server.
 *
 * NOT decoration. iOS discards service-worker storage after about a week of
 * non-use, so an invisible queued fuel fill can vanish and leave a hole in the
 * very history the window-replacement ROI is computed from. Making the queue
 * visible is the only thing standing between that and silence.
 *
 * It renders nothing when the queue is empty and nothing has failed — a banner
 * that is always present stops being read.
 */

export interface PendingQueueBannerProps {
  pending: QueuedRequest[];
  /** A storage fault: the queue could not be READ. Not the same as empty. */
  error: string | null;
  onRetry: () => void;
}

export function PendingQueueBanner({
  pending,
  error,
  onRetry,
}: PendingQueueBannerProps) {
  /*
   * The error case comes FIRST and is never collapsed into "nothing pending".
   * An unreadable queue means "I cannot tell what is waiting", which is the
   * opposite of "nothing is waiting" — and the difference matters to someone
   * deciding whether to log a fill again.
   */
  if (error) {
    return (
      <div
        role="alert"
        className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3"
      >
        <p className="font-medium text-red-900">
          Cannot read the offline queue on this device.
        </p>
        <p className="mt-1 text-sm text-red-800">
          Anything logged while offline may not be saved. Do not assume it sent.
        </p>
        <p className="mt-1 font-mono text-xs text-red-700">{error}</p>
      </div>
    );
  }

  const state = describePending(pending);

  if (!state.visible) return null;

  const tone = state.stale
    ? 'border-amber-400 bg-amber-50 text-amber-900'
    : 'border-sky-300 bg-sky-50 text-sky-900';

  return (
    <div role="status" className={`mb-4 rounded-lg border px-4 py-3 ${tone}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">
            {state.stale ? 'Waiting too long to send' : 'Waiting to send'}
          </p>
          <p className="mt-1 text-sm">{state.summary}</p>
        </div>

        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md border border-current px-3 py-1 text-sm font-medium"
        >
          Try now
        </button>
      </div>
    </div>
  );
}
