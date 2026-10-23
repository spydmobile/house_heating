import { describe, it, expect } from 'vitest';
import {
  createWeatherSync,
  type SyncWeatherStore,
  type SyncFetcher,
} from './createWeatherSync';

/**
 * Keeps the weather series current by catching up from the last recorded day.
 *
 * Converted from `weatherSync.ts`, which read and wrote through the old SQLite
 * handle and called `setInterval` at module scope — so none of its date
 * arithmetic, which is all it really is, could be tested.
 *
 * The clock is injected. Without that, every test below would depend on the day
 * it happens to run.
 */

function fakeFetcher(): SyncFetcher & { calls: string[][] } {
  const calls: string[][] = [];

  return {
    calls,
    async fetchRange(from: string, to: string) {
      calls.push([from, to]);
      return { fetched: 1, skipped: 0, errors: [] };
    },
  };
}

function store(latest: string | null): SyncWeatherStore {
  return { async latestDate() { return latest; } };
}

/** 2026-02-25, so "yesterday" is 2026-02-24. */
const now = () => new Date(Date.UTC(2026, 1, 25, 12, 0, 0));

describe('createWeatherSync', () => {
  describe('when weather has never been recorded', () => {
    it('fetches the last thirty days rather than nothing', async () => {
      const fetcher = fakeFetcher();
      const sync = createWeatherSync({ weather: store(null), fetcher, now });

      await sync.catchUp();

      expect(fetcher.calls).toEqual([['2026-01-26', '2026-02-24']]);
    });
  });

  describe('when the series is behind', () => {
    /**
     * From the day AFTER the latest recorded date. Starting ON it would re-fetch
     * a day already held — harmless with an upsert, but it would also mean a
     * single stuck day could never be stepped past.
     */
    it('fetches from the day after the latest recorded date up to yesterday', async () => {
      const fetcher = fakeFetcher();
      const sync = createWeatherSync({
        weather: store('2026-02-20'),
        fetcher,
        now,
      });

      await sync.catchUp();

      expect(fetcher.calls).toEqual([['2026-02-21', '2026-02-24']]);
    });

    it('steps across a month boundary correctly', async () => {
      const fetcher = fakeFetcher();
      const sync = createWeatherSync({
        weather: store('2026-01-31'),
        fetcher,
        now,
      });

      await sync.catchUp();

      expect(fetcher.calls).toEqual([['2026-02-01', '2026-02-24']]);
    });
  });

  describe('when the series is current', () => {
    it('does nothing when the latest recorded date is yesterday', async () => {
      const fetcher = fakeFetcher();
      const sync = createWeatherSync({
        weather: store('2026-02-24'),
        fetcher,
        now,
      });

      await sync.catchUp();

      expect(fetcher.calls).toEqual([]);
    });

    /**
     * A date AHEAD of yesterday would produce an inverted range, which the
     * fetcher rejects by design. The sync must not generate one.
     */
    it('does nothing when the latest recorded date is in the future', async () => {
      const fetcher = fakeFetcher();
      const sync = createWeatherSync({
        weather: store('2026-03-10'),
        fetcher,
        now,
      });

      await sync.catchUp();

      expect(fetcher.calls).toEqual([]);
    });
  });

  /**
   * A failed sync must NEVER take the server down. Environment Canada being
   * unreachable is an ordinary condition at a remote site, and the app is fully
   * usable without today's weather.
   */
  describe('failure is contained', () => {
    it('does not throw when the fetch fails', async () => {
      const sync = createWeatherSync({
        weather: store('2026-02-20'),
        fetcher: {
          async fetchRange() {
            throw new Error('getaddrinfo ENOTFOUND dd.weather.gc.ca');
          },
        },
        now,
      });

      await expect(sync.catchUp()).resolves.toBeUndefined();
    });

    it('does not throw when the database lookup fails', async () => {
      const sync = createWeatherSync({
        weather: {
          async latestDate(): Promise<string | null> {
            throw new Error('connection terminated unexpectedly');
          },
        },
        fetcher: fakeFetcher(),
        now,
      });

      await expect(sync.catchUp()).resolves.toBeUndefined();
    });
  });

  describe('scheduling', () => {
    it('reports the interval it would run on without starting a timer in tests', () => {
      const sync = createWeatherSync({
        weather: store(null),
        fetcher: fakeFetcher(),
        now,
      });

      expect(sync.intervalMs).toBe(60 * 60 * 1000);
    });

    /**
     * `stop()` must be safe to call when nothing was started — the shutdown
     * path calls it unconditionally.
     */
    it('can be stopped without having been started', () => {
      const sync = createWeatherSync({
        weather: store(null),
        fetcher: fakeFetcher(),
        now,
      });

      expect(() => sync.stop()).not.toThrow();
    });
  });
});
