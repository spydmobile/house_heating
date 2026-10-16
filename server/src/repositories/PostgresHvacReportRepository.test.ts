import { describe, it, expect } from 'vitest';
import { PostgresHvacReportRepository } from './PostgresHvacReportRepository';
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
  id: 14,
  year: 2026,
  month: 1,
  total_runtime_hours: 327,
  avg_cycle_minutes: 18.4,
  avg_outdoor_temp: -21.2,
  avg_indoor_temp: 21.5,
  avg_setpoint: 22,
  notes: null,
  created_at: '2026-02-01T00:00:00.000Z',
};

describe('PostgresHvacReportRepository', () => {
  /**
   * The natural key is (year, month) — one report per month, re-imported
   * whenever a corrected thermostat report arrives. Upserting on the composite
   * key is what lets a correction replace a bad month instead of being refused
   * by the UNIQUE constraint. That matters here specifically: the 2024-25 rows
   * contradict themselves (2025-03 is 4.5C warmer than 2025-01 yet 2.7x the
   * runtime) and are the baseline side of the window-ROI comparison, so they
   * will need re-importing once audited.
   */
  it('upserts on the (year, month) composite key so a corrected report replaces a bad month', async () => {
    const client = fakeClient([dbRow]);
    const repo = new PostgresHvacReportRepository(client);

    await repo.save({
      year: 2026,
      month: 1,
      totalRuntimeHours: 327,
      avgCycleMinutes: 18.4,
      avgOutdoorTemp: -21.2,
      avgIndoorTemp: 21.5,
      avgSetpoint: 22,
      notes: null,
    });

    const [call] = client.calls;

    expect(call.sql).toMatch(/INSERT INTO hvac_reports/i);
    expect(call.sql).toMatch(/ON CONFLICT\s*\(\s*year\s*,\s*month\s*\)/i);
    expect(call.sql).toMatch(/RETURNING/i);
    expect(call.params).toEqual([2026, 1, 327, 18.4, -21.2, 21.5, 22, null]);
  });

  it('orders reports chronologically by year then month', async () => {
    const client = fakeClient([dbRow]);
    const repo = new PostgresHvacReportRepository(client);

    await repo.list();

    expect(client.calls[0].sql).toMatch(/ORDER BY year\s*,\s*month/i);
  });

  it('finds a single month, binding year and month as parameters', async () => {
    const client = fakeClient([dbRow]);
    const repo = new PostgresHvacReportRepository(client);

    const report = await repo.findByMonth(2026, 1);

    expect(client.calls[0].params).toEqual([2026, 1]);
    expect(report?.totalRuntimeHours).toBe(327);
  });

  it('returns null for a month with no report rather than undefined', async () => {
    const repo = new PostgresHvacReportRepository(fakeClient([]));

    expect(await repo.findByMonth(2024, 7)).toBeNull();
  });
});
