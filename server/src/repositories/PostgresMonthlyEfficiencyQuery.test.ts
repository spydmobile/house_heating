import { describe, it, expect } from 'vitest';
import { PostgresMonthlyEfficiencyQuery } from './PostgresMonthlyEfficiencyQuery';
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

/**
 * The SQLite original (routes/hvac.ts:142-154) correlated hvac_reports to
 * fuel_fills and weather_data with:
 *
 *     WHERE strftime('%Y', date) = CAST(h.year AS TEXT)
 *       AND CAST(strftime('%m', date) AS INTEGER) = h.month
 *
 * `strftime` does not exist in Postgres. This is a hard failure rather than a
 * subtle difference, which is the good case — it cannot ship silently broken.
 */
describe('PostgresMonthlyEfficiencyQuery', () => {
  it('uses EXTRACT rather than strftime, which does not exist in Postgres', async () => {
    const client = fakeClient();

    await new PostgresMonthlyEfficiencyQuery(client).list();

    const [call] = client.calls;

    expect(call.sql).not.toMatch(/strftime/i);
    expect(call.sql).toMatch(/EXTRACT\s*\(\s*YEAR\s+FROM/i);
    expect(call.sql).toMatch(/EXTRACT\s*\(\s*MONTH\s+FROM/i);
  });

  it('orders chronologically', async () => {
    const client = fakeClient();

    await new PostgresMonthlyEfficiencyQuery(client).list();

    expect(client.calls[0].sql).toMatch(/ORDER BY\s+h\.year\s*,\s*h\.month/i);
  });

  /**
   * SUM over NUMERIC returns a STRING from `pg`, and SUM over no rows returns
   * NULL. Both land in the same column, so this mapping has to distinguish
   * "no fuel recorded that month" from "0 litres" — they are different facts
   * and only one of them should produce an efficiency number.
   */
  it('converts summed NUMERIC strings to numbers', async () => {
    const client = fakeClient([
      {
        id: 1,
        year: 2026,
        month: 1,
        total_runtime_hours: 327,
        avg_cycle_minutes: 18.4,
        avg_outdoor_temp: -21.2,
        avg_indoor_temp: 21.5,
        avg_setpoint: 22,
        notes: null,
        created_at: '2026-02-01T00:00:00.000Z',
        fuel_liters: '511.70',
        total_hdd: 1218.4,
        weather_days: '28',
      },
    ]);

    const [row] = await new PostgresMonthlyEfficiencyQuery(client).list();

    expect(row.fuelLiters).toBe(511.7);
    expect(typeof row.fuelLiters).toBe('number');
    expect(row.totalHdd).toBe(1218.4);
  });

  it('keeps a month with no fuel recorded as null rather than reporting it as zero litres', async () => {
    const client = fakeClient([
      {
        id: 2,
        year: 2025,
        month: 7,
        total_runtime_hours: 0,
        avg_cycle_minutes: null,
        avg_outdoor_temp: 17.1,
        avg_indoor_temp: 21,
        avg_setpoint: 21,
        notes: null,
        created_at: '2025-08-01T00:00:00.000Z',
        fuel_liters: null,
        total_hdd: null,
        weather_days: '0',
      },
    ]);

    const [row] = await new PostgresMonthlyEfficiencyQuery(client).list();

    expect(row.fuelLiters).toBeNull();
    expect(row.totalHdd).toBeNull();
  });

  /**
   * The count of weather days behind each monthly HDD total. Without it, a
   * month with six days of data and a month with thirty-one produce HDD totals
   * that look equally authoritative — which is precisely how a comparison
   * concludes the new windows made the house worse.
   */
  it('reports how many weather days back each monthly HDD total', async () => {
    const client = fakeClient([
      {
        id: 3,
        year: 2026,
        month: 1,
        total_runtime_hours: 327,
        avg_cycle_minutes: null,
        avg_outdoor_temp: null,
        avg_indoor_temp: null,
        avg_setpoint: null,
        notes: null,
        created_at: '2026-02-01T00:00:00.000Z',
        fuel_liters: null,
        total_hdd: '188.2',
        weather_days: '6',
      },
    ]);

    const [row] = await new PostgresMonthlyEfficiencyQuery(client).list();

    expect(row.weatherDays).toBe(6);
  });
});
