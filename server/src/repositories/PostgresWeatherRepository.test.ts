import { describe, it, expect } from 'vitest';
import { PostgresWeatherRepository } from './PostgresWeatherRepository';
import type { QueryClient } from './QueryClient';

interface Recorded {
  sql: string;
  params?: unknown[];
}

function fakeClient(rows: unknown[] = []): QueryClient & { calls: Recorded[] } {
  const calls: Recorded[] = [];

  return {
    calls,
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

const dbRow = {
  id: 11,
  date: '2026-01-12',
  max_temp: -9.8,
  min_temp: -17.0,
  mean_temp: -13.4,
  hdd: 31.4,
  source: 'climate-archive',
  created_at: '2026-01-13T09:00:00.000Z',
};

describe('PostgresWeatherRepository', () => {
  /**
   * Weather is written by the server, never queued on a phone, so there is no
   * client_uuid here. Its natural key is the DATE — one row per day — and the
   * sync re-fetches overlapping ranges, so upserting on date is what stops a
   * re-run from either failing on the UNIQUE constraint or duplicating a day.
   */
  it('upserts on date so a re-run of the sync neither fails nor duplicates a day', async () => {
    const client = fakeClient([dbRow]);
    const repo = new PostgresWeatherRepository(client);

    await repo.save({
      date: '2026-01-12',
      maxTemp: -9.8,
      minTemp: -17,
      meanTemp: -13.4,
      hdd: 31.4,
      source: 'climate-archive',
    });

    const [call] = client.calls;

    expect(call.sql).toMatch(/INSERT INTO weather_data/i);
    expect(call.sql).toMatch(/ON CONFLICT\s*\(\s*date\s*\)/i);
    expect(call.sql).toMatch(/RETURNING/i);
  });

  /**
   * A day genuinely absent from every Fort Smith station must stay absent.
   * 2025-01-03 is such a day and it is recorded missing, never interpolated —
   * so a range query returns the days it has and the caller sees the hole,
   * rather than the repository inventing a value to fill it.
   */
  it('returns only the days it has for a range, binding the bounds as parameters', async () => {
    const client = fakeClient([dbRow]);
    const repo = new PostgresWeatherRepository(client);

    await repo.findBetween('2026-01-01', '2026-01-31');

    const [call] = client.calls;

    expect(call.sql).toMatch(/WHERE date BETWEEN \$1 AND \$2/i);
    expect(call.sql).toMatch(/ORDER BY date/i);
    expect(call.params).toEqual(['2026-01-01', '2026-01-31']);
  });

  it('sums HDD over a range and returns 0 for a range with no rows, not null', async () => {
    const empty = new PostgresWeatherRepository(fakeClient([{ total: null }]));

    expect(await empty.totalHdd('2025-01-01', '2025-03-31')).toBe(0);

    const populated = new PostgresWeatherRepository(fakeClient([{ total: '318.6' }]));

    expect(await populated.totalHdd('2026-01-01', '2026-03-31')).toBe(318.6);
  });

  /**
   * The count of days actually present is what makes an HDD total
   * interpretable. Six days of January cannot carry a quarterly total, and a
   * caller that only sees the sum cannot tell the difference.
   */
  it('counts the days present in a range alongside the total', async () => {
    const repo = new PostgresWeatherRepository(fakeClient([{ count: '6' }]));

    expect(await repo.countDays('2026-01-01', '2026-01-31')).toBe(6);
  });

  /**
   * `hddForPeriod` is NOT `totalHdd` and the difference is the whole point.
   *
   * It answers "what were the degree days BETWEEN two gauge readings", so it is
   * exclusive of the earlier day and inclusive of the later one — otherwise the
   * first day is counted in both of two adjacent periods.
   *
   * And it returns NULL for a period with no weather rows, where `totalHdd`
   * returns 0. A consumption figure divided by an invented zero is how a
   * comparison concludes the new windows made the house worse; the caller has
   * to be able to tell "no data" from "a mild period".
   */
  describe('hddForPeriod', () => {
    it('excludes the earlier day and includes the later one', async () => {
      const client = fakeClient([{ total: '523.6', count: '14' }]);
      const repo = new PostgresWeatherRepository(client);

      await repo.hddForPeriod('2025-12-15', '2025-12-29');

      const [call] = client.calls;

      expect(call.sql).toMatch(/date\s*>\s*\$1/i);
      expect(call.sql).toMatch(/date\s*<=\s*\$2/i);
      expect(call.params).toEqual(['2025-12-15', '2025-12-29']);
    });

    it('returns the summed degree days when the period has weather', async () => {
      const repo = new PostgresWeatherRepository(
        fakeClient([{ total: '523.6', count: '14' }]),
      );

      expect(await repo.hddForPeriod('2025-12-15', '2025-12-29')).toBe(523.6);
    });

    it('returns null — not 0 — for a period with no weather rows at all', async () => {
      const repo = new PostgresWeatherRepository(
        fakeClient([{ total: null, count: '0' }]),
      );

      expect(await repo.hddForPeriod('2025-01-01', '2025-01-31')).toBeNull();
    });

    it('returns 0 for a period that genuinely had no heating demand', async () => {
      const repo = new PostgresWeatherRepository(
        fakeClient([{ total: '0', count: '14' }]),
      );

      expect(await repo.hddForPeriod('2025-07-15', '2025-07-29')).toBe(0);
    });
  });

  describe('summary', () => {
    it('reports temperature aggregates with the day count that backs them', async () => {
      const repo = new PostgresWeatherRepository(
        fakeClient([
          {
            avg_mean_temp: '-13.4',
            min_temp: '-34.2',
            max_temp: '4.1',
            total_hdd: '981.2',
            day_count: '28',
          },
        ]),
      );

      const summary = await repo.summary('2026-01-01', '2026-01-31');

      expect(summary.avgMeanTemp).toBe(-13.4);
      expect(summary.minTemp).toBe(-34.2);
      expect(summary.maxTemp).toBe(4.1);
      expect(summary.totalHdd).toBe(981.2);
      expect(summary.dayCount).toBe(28);
    });

    /**
     * An empty range must report dayCount 0 and nulls, never zeroes. A summary
     * claiming an average temperature of 0 °C for a range it has no data for
     * would be a fabricated reading, and 0 °C is plausible enough here to go
     * unnoticed.
     */
    it('reports nulls and a zero day count for a range with no data', async () => {
      const repo = new PostgresWeatherRepository(
        fakeClient([
          {
            avg_mean_temp: null,
            min_temp: null,
            max_temp: null,
            total_hdd: null,
            day_count: '0',
          },
        ]),
      );

      const summary = await repo.summary('2025-01-01', '2025-03-31');

      expect(summary.avgMeanTemp).toBeNull();
      expect(summary.minTemp).toBeNull();
      expect(summary.maxTemp).toBeNull();
      expect(summary.totalHdd).toBeNull();
      expect(summary.dayCount).toBe(0);
    });
  });

  describe('deleteByDate', () => {
    it('reports whether a day was actually removed', async () => {
      expect(
        await new PostgresWeatherRepository(fakeClient([])).deleteByDate('2026-01-12'),
      ).toBe(false);
      expect(
        await new PostgresWeatherRepository(
          fakeClient([{ date: '2026-01-12' }]),
        ).deleteByDate('2026-01-12'),
      ).toBe(true);
    });

    it('binds the date rather than interpolating it', async () => {
      const client = fakeClient([{ date: '2026-01-12' }]);

      await new PostgresWeatherRepository(client).deleteByDate('2026-01-12');

      expect(client.calls[0].params).toEqual(['2026-01-12']);
      expect(client.calls[0].sql).not.toContain('2026-01-12');
    });
  });

  describe('list', () => {
    it('returns every day, newest first, when no range is given', async () => {
      const client = fakeClient([dbRow]);

      await new PostgresWeatherRepository(client).list();

      expect(client.calls[0].sql).toMatch(/ORDER BY date DESC/i);
      expect(client.calls[0].params ?? []).toEqual([]);
    });
  });

  /**
   * `findRange` takes OPTIONAL bounds, because the client's `getWeather(from?,
   * to?)` can send either, both, or neither — and Dashboard.tsx calls it with
   * none. The old sqlite route handled this by concatenating clauses onto a
   * query string; this builds the same four shapes with bound parameters
   * instead, so a bound can never become part of the SQL text.
   */
  describe('findRange', () => {
    it('returns every day when neither bound is given', async () => {
      const client = fakeClient([dbRow]);

      await new PostgresWeatherRepository(client).findRange(null, null);

      expect(client.calls[0].sql).not.toMatch(/WHERE/i);
      expect(client.calls[0].params ?? []).toEqual([]);
    });

    it('filters on both bounds when both are given', async () => {
      const client = fakeClient([dbRow]);

      await new PostgresWeatherRepository(client).findRange('2026-01-01', '2026-01-31');

      expect(client.calls[0].sql).toMatch(/date\s*>=\s*\$1/i);
      expect(client.calls[0].sql).toMatch(/date\s*<=\s*\$2/i);
      expect(client.calls[0].params).toEqual(['2026-01-01', '2026-01-31']);
    });

    it('filters from a start date only', async () => {
      const client = fakeClient([dbRow]);

      await new PostgresWeatherRepository(client).findRange('2026-01-01', null);

      expect(client.calls[0].sql).toMatch(/date\s*>=\s*\$1/i);
      expect(client.calls[0].sql).not.toMatch(/<=/);
      expect(client.calls[0].params).toEqual(['2026-01-01']);
    });

    it('filters to an end date only', async () => {
      const client = fakeClient([dbRow]);

      await new PostgresWeatherRepository(client).findRange(null, '2026-01-31');

      expect(client.calls[0].sql).toMatch(/date\s*<=\s*\$1/i);
      expect(client.calls[0].params).toEqual(['2026-01-31']);
    });

    it('never puts a bound into the SQL text', async () => {
      const client = fakeClient([dbRow]);

      await new PostgresWeatherRepository(client).findRange('2026-01-01', '2026-01-31');

      expect(client.calls[0].sql).not.toContain('2026-01-01');
      expect(client.calls[0].sql).not.toContain('2026-01-31');
    });
  });
});
