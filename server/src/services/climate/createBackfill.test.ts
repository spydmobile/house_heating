import { describe, it, expect } from 'vitest';
import {
  createBackfill,
  type BackfillArchive,
  type BackfillStore,
} from './createBackfill';
import type { ArchiveDay, FetchDaysResult } from './createClimateArchive';

/**
 * Fills a date range from the climate archive, recording which station each day
 * came from.
 *
 * The rules here are the ones that decide whether the window-replacement ROI is
 * trustworthy, so each is tested rather than assumed:
 *
 *   ZSM FIRST, YSM ONLY FOR WHAT ZSM LACKS. They are different instruments at
 *   different coordinates. Asking the airport for days the climate station
 *   already has would mix two series for no reason.
 *
 *   A DAY NEITHER STATION HAS IS RECORDED MISSING AND NEVER INTERPOLATED.
 *   2025-01-03 is such a day — verified against the live archive, where the row
 *   exists with a null temperature.
 *
 *   NOTHING IS WRITTEN WITHOUT PROVENANCE. A day stored without its station is
 *   the exact defect the old fetcher had.
 */

function day(date: string, station: string, hdd: number): ArchiveDay {
  return {
    date,
    station,
    maxTemp: -10,
    minTemp: -20,
    meanTemp: 18 - hdd,
    hdd,
  };
}

function result(days: ArchiveDay[], missing: string[] = []): FetchDaysResult {
  return { days, missing, hddDiscrepancies: [], warnings: [] };
}

function fakeArchive(
  byStation: Record<string, FetchDaysResult>,
): BackfillArchive & { asked: string[][] } {
  const asked: string[][] = [];

  return {
    asked,
    async fetchDays(station: string, from: string, to: string) {
      asked.push([station, from, to]);
      return byStation[station] ?? result([]);
    },
  };
}

function fakeStore() {
  const saved: { date: string; station: string | null; hdd: number | null }[] = [];

  const store: BackfillStore & { saved: typeof saved } = {
    saved,
    async save(d) {
      saved.push({ date: d.date, station: d.station, hdd: d.hdd });
      return undefined;
    },
  };

  return store;
}

describe('createBackfill', () => {
  it('fills from ZSM, writing the station with every day', async () => {
    const archive = fakeArchive({
      ZSM: result([day('2025-01-01', 'ZSM', 43.9), day('2025-01-02', 'ZSM', 48.5)]),
    });
    const store = fakeStore();

    const report = await createBackfill({ archive, weather: store }).run(
      '2025-01-01',
      '2025-01-02',
    );

    expect(store.saved).toHaveLength(2);
    expect(store.saved.every((d) => d.station === 'ZSM')).toBe(true);
    expect(report.written).toBe(2);
  });

  describe('the secondary station', () => {
    it('asks YSM only for the days ZSM did not have', async () => {
      const archive = fakeArchive({
        ZSM: result([day('2026-01-11', 'ZSM', 30)], ['2026-01-12']),
        YSM: result([day('2026-01-12', 'YSM', 31.4)]),
      });

      await createBackfill({ archive, weather: fakeStore() }).run(
        '2026-01-11',
        '2026-01-12',
      );

      expect(archive.asked[0][0]).toBe('ZSM');
      expect(archive.asked[1]).toEqual(['YSM', '2026-01-12', '2026-01-12']);
    });

    it('does not consult YSM at all when ZSM covered the range', async () => {
      const archive = fakeArchive({
        ZSM: result([day('2025-01-01', 'ZSM', 43.9)]),
      });

      await createBackfill({ archive, weather: fakeStore() }).run(
        '2025-01-01',
        '2025-01-01',
      );

      expect(archive.asked.map((a) => a[0])).toEqual(['ZSM']);
    });

    it('records the secondary-station days as YSM, so the mix is visible in the data', async () => {
      const archive = fakeArchive({
        ZSM: result([day('2026-01-11', 'ZSM', 30)], ['2026-01-12']),
        YSM: result([day('2026-01-12', 'YSM', 31.4)]),
      });
      const store = fakeStore();

      const report = await createBackfill({ archive, weather: store }).run(
        '2026-01-11',
        '2026-01-12',
      );

      const secondary = store.saved.find((d) => d.date === '2026-01-12');

      expect(secondary?.station).toBe('YSM');
      expect(report.fromSecondary).toEqual(['2026-01-12']);
    });
  });

  describe('a day neither station has', () => {
    /**
     * 2025-01-03. It is reported, it is counted, and it is NOT written — an
     * invented value in the baseline quarter would bias the comparison the
     * whole project exists to make.
     */
    it('records it missing and writes nothing for it', async () => {
      const archive = fakeArchive({
        ZSM: result([day('2025-01-02', 'ZSM', 48.5)], ['2025-01-03']),
        YSM: result([], ['2025-01-03']),
      });
      const store = fakeStore();

      const report = await createBackfill({ archive, weather: store }).run(
        '2025-01-02',
        '2025-01-03',
      );

      expect(report.missing).toEqual(['2025-01-03']);
      expect(store.saved.some((d) => d.date === '2025-01-03')).toBe(false);
    });

    it('never interpolates it from the surrounding days', async () => {
      const archive = fakeArchive({
        ZSM: result(
          [day('2025-01-02', 'ZSM', 48.5), day('2025-01-04', 'ZSM', 41.7)],
          ['2025-01-03'],
        ),
        YSM: result([], ['2025-01-03']),
      });
      const store = fakeStore();

      await createBackfill({ archive, weather: store }).run('2025-01-02', '2025-01-04');

      expect(store.saved.map((d) => d.date)).toEqual(['2025-01-02', '2025-01-04']);
    });
  });

  describe('the report it returns', () => {
    it('counts what was written, what came from the secondary station, and what is missing', async () => {
      const archive = fakeArchive({
        ZSM: result(
          [day('2026-01-10', 'ZSM', 30), day('2026-01-11', 'ZSM', 31)],
          ['2026-01-12', '2026-01-13'],
        ),
        YSM: result([day('2026-01-12', 'YSM', 31.4)], ['2026-01-13']),
      });

      const report = await createBackfill({
        archive,
        weather: fakeStore(),
      }).run('2026-01-10', '2026-01-13');

      expect(report.written).toBe(3);
      expect(report.fromSecondary).toEqual(['2026-01-12']);
      expect(report.missing).toEqual(['2026-01-13']);
    });

    /**
     * Coverage is reported as a fraction of the range, because a total degree
     * day figure means nothing without it. This is the number that decides
     * whether a quarter may be compared at all.
     */
    it('reports coverage against the days the range actually contains', async () => {
      const archive = fakeArchive({
        ZSM: result([day('2025-01-01', 'ZSM', 43.9)], ['2025-01-02', '2025-01-03']),
        YSM: result([], ['2025-01-02', '2025-01-03']),
      });

      const report = await createBackfill({
        archive,
        weather: fakeStore(),
      }).run('2025-01-01', '2025-01-03');

      expect(report.expectedDays).toBe(3);
      expect(report.written).toBe(1);
    });
  });

  describe('failure', () => {
    /**
     * A write failure must not be reported as a missing day. A failing database
     * would otherwise be indistinguishable from weather that was never
     * recorded — and one of those is fixable.
     */
    it('reports a store failure as an error, not as a missing day', async () => {
      const archive = fakeArchive({
        ZSM: result([day('2025-01-01', 'ZSM', 43.9)]),
      });

      const report = await createBackfill({
        archive,
        weather: {
          async save() {
            throw new Error('connection terminated unexpectedly');
          },
        },
      }).run('2025-01-01', '2025-01-01');

      expect(report.written).toBe(0);
      expect(report.missing).toEqual([]);
      expect(report.errors.join(' ')).toMatch(/2025-01-01/);
    });

    it('lets an archive failure propagate rather than reporting a short fill', async () => {
      const archive: BackfillArchive = {
        async fetchDays() {
          throw new Error('Climate archive returned 503');
        },
      };

      await expect(
        createBackfill({ archive, weather: fakeStore() }).run(
          '2025-01-01',
          '2025-03-31',
        ),
      ).rejects.toThrow(/503/);
    });
  });
});
