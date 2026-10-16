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
});
