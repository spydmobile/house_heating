import { describe, it, expect } from 'vitest';
import { createWeatherFetcher, type FetcherWeatherStore } from './createWeatherFetcher';
import type { NewWeatherDay, WeatherDay } from '../repositories/PostgresWeatherRepository';

/**
 * The Environment Canada range fetch, with HTTP and storage injected.
 *
 * The original called `fetch` directly and inserted through a module-level
 * SQLite handle, so none of this was testable — including the date arithmetic,
 * which is the part most likely to be wrong.
 */

function xml(station: string, high: string, low: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<om:ObservationCollection xmlns:om="http://www.opengis.net/om/1.0">
  <om:member><om:Observation>
    <om:metadata><set><identification-elements>
      <element name="station_name" value="FORT SMITH CLIMATE"/>
      <element name="transport_canada_id" value="${station}"/>
    </identification-elements></set></om:metadata>
    <om:result><elements>
      <element name="air_temperature_yesterday_high" value="${high}"/>
      <element name="air_temperature_yesterday_low" value="${low}"/>
    </elements></om:result>
  </om:Observation></om:member>
</om:ObservationCollection>`;
}

function fakeStore() {
  const saved: NewWeatherDay[] = [];

  const store: FetcherWeatherStore & { saved: NewWeatherDay[] } = {
    saved,
    async save(day: NewWeatherDay) {
      saved.push(day);
      return { id: saved.length, createdAt: '', ...day } as WeatherDay;
    },
  };

  return store;
}

/** Responds 200 with ZSM data for every URL. */
function okFetch(body = xml('ZSM', '-9.8', '-17.0')) {
  const urls: string[] = [];

  const fn = async (url: string) => {
    urls.push(url);
    return { ok: true, text: async () => body };
  };

  return Object.assign(fn, { urls });
}

describe('createWeatherFetcher', () => {
  it('fetches and stores a single day', async () => {
    const store = fakeStore();
    const fetcher = createWeatherFetcher({
      weather: store,
      fetch: okFetch(),
      baseUrl: 'https://dd.weather.gc.ca',
    });

    const result = await fetcher.fetchRange('2026-01-12', '2026-01-12');

    expect(result.fetched).toBe(1);
    expect(result.skipped).toBe(0);
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0].date).toBe('2026-01-12');
    expect(store.saved[0].hdd).toBe(31.4);
  });

  /**
   * The station the reading came from is written into `source`, so a day from
   * the airport is distinguishable from a day from the climate station without
   * a schema change. The original wrote 'auto' for both.
   */
  it('records the station in source rather than a bare "auto"', async () => {
    const store = fakeStore();
    const fetcher = createWeatherFetcher({
      weather: store,
      fetch: okFetch(xml('YSM', '-5.0', '-15.0')),
      baseUrl: 'https://dd.weather.gc.ca',
    });

    await fetcher.fetchRange('2026-01-12', '2026-01-12');

    expect(store.saved[0].source).toBe('auto:YSM');
  });

  /**
   * THE DATE ARITHMETIC, which was untestable before and is easy to get wrong:
   * the file containing a given day's observations is dated the FOLLOWING day,
   * because it is "yesterday's" file.
   */
  it('requests the file dated the day AFTER the observation date', async () => {
    const fetch = okFetch();
    const fetcher = createWeatherFetcher({
      weather: fakeStore(),
      fetch,
      baseUrl: 'https://dd.weather.gc.ca',
    });

    await fetcher.fetchRange('2026-01-12', '2026-01-12');

    expect(fetch.urls[0]).toContain('20260113');
    expect(fetch.urls[0]).not.toContain('20260112');
  });

  /**
   * A month boundary is where naive date stepping breaks, and a DST boundary is
   * where local-time stepping breaks. Fort Smith observes DST, so the iteration
   * is done in UTC.
   */
  it('steps across a month boundary without skipping or repeating a day', async () => {
    const store = fakeStore();
    const fetcher = createWeatherFetcher({
      weather: store,
      fetch: okFetch(),
      baseUrl: 'https://dd.weather.gc.ca',
    });

    await fetcher.fetchRange('2026-01-30', '2026-02-02');

    expect(store.saved.map((day) => day.date)).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
  });

  it('steps across the spring DST boundary without losing a day', async () => {
    const store = fakeStore();
    const fetcher = createWeatherFetcher({
      weather: store,
      fetch: okFetch(),
      baseUrl: 'https://dd.weather.gc.ca',
    });

    await fetcher.fetchRange('2026-03-07', '2026-03-10');

    expect(store.saved.map((day) => day.date)).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
  });

  it('handles a leap day', async () => {
    const store = fakeStore();
    const fetcher = createWeatherFetcher({
      weather: store,
      fetch: okFetch(),
      baseUrl: 'https://dd.weather.gc.ca',
    });

    await fetcher.fetchRange('2028-02-28', '2028-03-01');

    expect(store.saved.map((day) => day.date)).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
  });

  describe('when a day cannot be fetched', () => {
    it('reports it as skipped with the date named, and continues the range', async () => {
      const store = fakeStore();
      const fetcher = createWeatherFetcher({
        weather: store,
        fetch: async (url: string) => {
          if (url.includes('20260113')) return { ok: false, text: async () => '' };
          return { ok: true, text: async () => xml('ZSM', '-9.8', '-17.0') };
        },
        baseUrl: 'https://dd.weather.gc.ca',
      });

      const result = await fetcher.fetchRange('2026-01-12', '2026-01-14');

      expect(result.fetched).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.errors.join(' ')).toContain('2026-01-12');
      expect(store.saved).toHaveLength(2);
    });

    /**
     * A network error must skip the day, not abort the run. A range fetch that
     * dies halfway leaves a partial series with no record of where it stopped.
     */
    it('survives a thrown network error', async () => {
      const fetcher = createWeatherFetcher({
        weather: fakeStore(),
        fetch: async () => {
          throw new Error('getaddrinfo ENOTFOUND');
        },
        baseUrl: 'https://dd.weather.gc.ca',
      });

      const result = await fetcher.fetchRange('2026-01-12', '2026-01-12');

      expect(result.fetched).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('tries the dated archive path when the rolling path misses', async () => {
      const urls: string[] = [];
      const fetcher = createWeatherFetcher({
        weather: fakeStore(),
        fetch: async (url: string) => {
          urls.push(url);
          if (url.includes('/today/')) return { ok: false, text: async () => '' };
          return { ok: true, text: async () => xml('ZSM', '-9.8', '-17.0') };
        },
        baseUrl: 'https://dd.weather.gc.ca',
      });

      const result = await fetcher.fetchRange('2026-01-12', '2026-01-12');

      expect(urls).toHaveLength(2);
      expect(result.fetched).toBe(1);
    });
  });

  /**
   * An inverted range is a caller mistake. The original's `while (current <=
   * end)` simply did nothing, reporting a successful fetch of zero days —
   * indistinguishable from a range that genuinely had no data.
   */
  it('rejects an inverted range rather than silently fetching nothing', async () => {
    const fetcher = createWeatherFetcher({
      weather: fakeStore(),
      fetch: okFetch(),
      baseUrl: 'https://dd.weather.gc.ca',
    });

    await expect(fetcher.fetchRange('2026-01-14', '2026-01-12')).rejects.toThrow(
      /range/i,
    );
  });

  it('rejects a malformed date rather than building a nonsense URL', async () => {
    const fetcher = createWeatherFetcher({
      weather: fakeStore(),
      fetch: okFetch(),
      baseUrl: 'https://dd.weather.gc.ca',
    });

    await expect(fetcher.fetchRange('not-a-date', '2026-01-12')).rejects.toThrow();
  });

  /**
   * A storage failure is NOT a skipped day. A day that was fetched but could
   * not be written must be reported as an error, or a failing database looks
   * like missing weather.
   */
  it('reports a storage failure as an error rather than as a skipped day', async () => {
    const fetcher = createWeatherFetcher({
      weather: {
        async save(): Promise<WeatherDay> {
          throw new Error('connection terminated unexpectedly');
        },
      },
      fetch: okFetch(),
      baseUrl: 'https://dd.weather.gc.ca',
    });

    const result = await fetcher.fetchRange('2026-01-12', '2026-01-12');

    expect(result.fetched).toBe(0);
    expect(result.errors.join(' ')).toMatch(/2026-01-12/);
    expect(result.errors.join(' ')).toMatch(/stor|writ|save/i);
  });
});
