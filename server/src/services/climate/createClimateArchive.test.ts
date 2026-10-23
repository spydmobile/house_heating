import { describe, it, expect } from 'vitest';
import { createClimateArchive, type ArchiveHttpGet } from './createClimateArchive';

/**
 * Reads daily records from the Environment Canada climate archive.
 *
 * This is the integration the old `weatherFetcher` could not do: that one hit a
 * ROLLING "yesterday" file, so it could only ever reach back a few days however
 * wide a range it was given. The archive is a real historical series — ZSM runs
 * 2003-08-01 to present — which is what makes backfilling Q1 2025 possible at
 * all.
 *
 * TWO THINGS VERIFIED AGAINST THE LIVE API on 2026-10-23, both of which change
 * the design:
 *
 *   1. A DAY WITH NO MEASUREMENT STILL RETURNS A ROW. 2025-01-03 at ZSM comes
 *      back as one feature with MEAN_TEMPERATURE null and HEATING_DEGREE_DAYS
 *      null. My own recorded basis said that day "exists at no Fort Smith
 *      station", which is wrong in a way that matters: a fetcher treating the
 *      presence of a feature as the presence of data would insert a
 *      null-temperature day and it would look like a reading.
 *
 *   2. THE ARCHIVE SHIPS ITS OWN HEATING_DEGREE_DAYS, at base 18. Measured:
 *      mean -27.1 gives 45.1, which is exactly 18 - (-27.1). That is the first
 *      KNOWN-POSITIVE CONTROL this project has ever had for calculateHDD, so
 *      the fetcher compares the two and reports disagreement rather than
 *      silently preferring one.
 */

function feature(date: string, mean: number | null, hdd: number | null) {
  return {
    properties: {
      LOCAL_DATE: `${date} 00:00:00`,
      STN_ID: 41884,
      STATION_NAME: 'FORT SMITH CLIMATE',
      MEAN_TEMPERATURE: mean,
      MAX_TEMPERATURE: mean === null ? null : mean + 5,
      MIN_TEMPERATURE: mean === null ? null : mean - 5,
      HEATING_DEGREE_DAYS: hdd,
    },
  };
}

function fakeHttp(features: unknown[], numberMatched?: number): ArchiveHttpGet & {
  urls: string[];
} {
  const urls: string[] = [];

  const fn = async (url: string) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        features,
        numberMatched: numberMatched ?? features.length,
      }),
    };
  };

  return Object.assign(fn, { urls });
}

const archive = (http: ArchiveHttpGet) =>
  createClimateArchive({ fetch: http, baseUrl: 'https://api.weather.gc.ca' });

describe('createClimateArchive', () => {
  describe('the request it builds', () => {
    it('asks for the resolved STN_ID, not the three-letter code', async () => {
      const http = fakeHttp([feature('2025-01-01', -25.9, 43.9)]);

      await archive(http).fetchDays('ZSM', '2025-01-01', '2025-01-01');

      expect(http.urls[0]).toContain('STN_ID=41884');
      expect(http.urls[0]).not.toMatch(/STN_ID=ZSM/);
    });

    it('throws on an unknown station before issuing any request', async () => {
      const http = fakeHttp([]);

      await expect(
        archive(http).fetchDays('XXX', '2025-01-01', '2025-01-02'),
      ).rejects.toThrow(/XXX/);

      expect(http.urls).toHaveLength(0);
    });

    it('bounds the request by the date range and sorts by date', async () => {
      const http = fakeHttp([feature('2025-01-01', -25.9, 43.9)]);

      await archive(http).fetchDays('ZSM', '2025-01-01', '2025-03-31');

      expect(http.urls[0]).toContain('2025-01-01');
      expect(http.urls[0]).toContain('2025-03-31');
      expect(http.urls[0]).toMatch(/sortby=LOCAL_DATE/);
    });

    it('rejects a malformed or inverted range rather than building a nonsense query', async () => {
      const http = fakeHttp([]);

      await expect(
        archive(http).fetchDays('ZSM', 'January', '2025-03-31'),
      ).rejects.toThrow();
      await expect(
        archive(http).fetchDays('ZSM', '2025-03-31', '2025-01-01'),
      ).rejects.toThrow(/range/i);
    });
  });

  describe('a day with no measurement', () => {
    /**
     * 2025-01-03 — verified against the live archive. The row is present and
     * the measurement is null. Those are different facts and the distinction
     * is the whole reason this case is tested.
     */
    it('reports a null-temperature day as missing rather than as a reading', async () => {
      const http = fakeHttp([
        feature('2025-01-02', -30.5, 48.5),
        feature('2025-01-03', null, null),
        feature('2025-01-04', -23.7, 41.7),
      ]);

      const result = await archive(http).fetchDays('ZSM', '2025-01-02', '2025-01-04');

      expect(result.days.map((d) => d.date)).toEqual(['2025-01-02', '2025-01-04']);
      expect(result.missing).toEqual(['2025-01-03']);
    });

    it('never interpolates a missing day from its neighbours', async () => {
      const http = fakeHttp([
        feature('2025-01-02', -30.5, 48.5),
        feature('2025-01-03', null, null),
        feature('2025-01-04', -23.7, 41.7),
      ]);

      const result = await archive(http).fetchDays('ZSM', '2025-01-02', '2025-01-04');

      expect(result.days).toHaveLength(2);
      expect(result.days.some((d) => d.date === '2025-01-03')).toBe(false);
    });
  });

  describe('provenance', () => {
    it('attaches the station code to every day it returns', async () => {
      const http = fakeHttp([feature('2025-01-01', -25.9, 43.9)]);

      const result = await archive(http).fetchDays('ZSM', '2025-01-01', '2025-01-01');

      expect(result.days[0].station).toBe('ZSM');
    });

    it('attaches the fallback station code when that is what was asked for', async () => {
      const http = fakeHttp([feature('2026-01-12', -13.4, 31.4)]);

      const result = await archive(http).fetchDays('YSM', '2026-01-12', '2026-01-12');

      expect(result.days[0].station).toBe('YSM');
    });
  });

  describe('the archive HDD as a control on our own calculation', () => {
    /**
     * HDD at base 18 is 18 - mean. The archive publishes its own figure, so for
     * the first time this project can CHECK its calculation instead of trusting
     * it. mean -25.9 -> 43.9.
     */
    it('agrees with calculateHDD on a normal day and reports no discrepancy', async () => {
      const http = fakeHttp([feature('2025-01-01', -25.9, 43.9)]);

      const result = await archive(http).fetchDays('ZSM', '2025-01-01', '2025-01-01');

      expect(result.days[0].hdd).toBeCloseTo(43.9, 1);
      expect(result.hddDiscrepancies).toEqual([]);
    });

    /**
     * A disagreement is REPORTED, not silently resolved. If the archive and our
     * formula diverge, one of them is wrong about the metric the whole project
     * is denominated in, and that is not a thing to paper over by picking a
     * winner.
     */
    it('reports a discrepancy when the archive HDD disagrees with the formula', async () => {
      const http = fakeHttp([feature('2025-01-01', -25.9, 99.9)]);

      const result = await archive(http).fetchDays('ZSM', '2025-01-01', '2025-01-01');

      expect(result.hddDiscrepancies).toHaveLength(1);
      expect(result.hddDiscrepancies[0].date).toBe('2025-01-01');
    });

    /**
     * A mean above 18 means no heating demand: HDD is 0, not negative. The
     * archive agrees, and a negative would silently reduce a quarterly total.
     */
    it('floors HDD at zero for a warm day', async () => {
      const http = fakeHttp([feature('2025-07-15', 21.5, 0)]);

      const result = await archive(http).fetchDays('ZSM', '2025-07-15', '2025-07-15');

      expect(result.days[0].hdd).toBe(0);
      expect(result.hddDiscrepancies).toEqual([]);
    });
  });

  describe('paging', () => {
    /**
     * A quarter is ~90 days and the archive caps a page. Stopping at the first
     * page would silently return a short series — and a short series is exactly
     * how a degree-day total comes out too low and makes a comparison lie.
     */
    it('follows pages until it has everything the archive reports as matching', async () => {
      const pages = [
        [feature('2025-01-01', -25.9, 43.9), feature('2025-01-02', -30.5, 48.5)],
        [feature('2025-01-03', -20.0, 38.0)],
      ];
      let call = 0;
      const urls: string[] = [];

      const http: ArchiveHttpGet = async (url: string) => {
        urls.push(url);
        const features = pages[call] ?? [];
        call += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ features, numberMatched: 3 }),
        };
      };

      const result = await createClimateArchive({
        fetch: http,
        baseUrl: 'https://api.weather.gc.ca',
        pageSize: 2,
      }).fetchDays('ZSM', '2025-01-01', '2025-01-03');

      expect(result.days).toHaveLength(3);
      expect(urls).toHaveLength(2);
      expect(urls[1]).toMatch(/offset=2/);
    });
  });

  describe('failure', () => {
    it('throws rather than returning a short series when the archive errors', async () => {
      const http: ArchiveHttpGet = async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      });

      await expect(
        createClimateArchive({ fetch: http, baseUrl: 'https://api.weather.gc.ca' })
          .fetchDays('ZSM', '2025-01-01', '2025-01-31'),
      ).rejects.toThrow(/503/);
    });

    /**
     * An empty result for a range the series should cover is suspicious, not
     * success. Returning zero days quietly would read downstream as "that
     * quarter had no weather", which is the artifact this backfill exists to
     * remove.
     */
    it('reports an entirely empty range rather than returning silently', async () => {
      const http = fakeHttp([], 0);

      const result = await archive(http).fetchDays('ZSM', '2025-01-01', '2025-01-31');

      expect(result.days).toEqual([]);
      expect(result.warnings.join(' ')).toMatch(/no days/i);
    });
  });
});
