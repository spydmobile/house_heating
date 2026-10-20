import { describe, it, expect } from 'vitest';
import { PostgresAnalysisQuery } from './PostgresAnalysisQuery';
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
 * Read model backing the four /api/analysis routes. Every method here exists
 * because no entity repository (fills, weather, readings) expresses the
 * aggregate the old sqlite route computed inline.
 */
describe('PostgresAnalysisQuery', () => {
  describe('latestGaugeReading', () => {
    it('queries gauge_readings ordered by date desc, limited to one', async () => {
      const client = fakeClient([]);

      await new PostgresAnalysisQuery(client).latestGaugeReading();

      const [call] = client.calls;
      expect(call.sql).toMatch(/FROM gauge_readings/i);
      expect(call.sql).toMatch(/ORDER BY date DESC/i);
      expect(call.sql).toMatch(/LIMIT 1/i);
    });

    it('returns null when there are no readings', async () => {
      const result = await new PostgresAnalysisQuery(fakeClient([])).latestGaugeReading();
      expect(result).toBeNull();
    });

    it('converts the NUMERIC gauge_percent to a number', async () => {
      const client = fakeClient([
        {
          id: 1,
          client_uuid: null,
          date: '2026-02-24',
          gauge_percent: '12.5',
          notes: null,
          created_at: '2026-02-24T00:00:00.000Z',
        },
      ]);

      const result = await new PostgresAnalysisQuery(client).latestGaugeReading();

      expect(result?.gaugePercent).toBe(12.5);
      expect(typeof result?.gaugePercent).toBe('number');
    });
  });

  describe('latestFuelFill', () => {
    it('queries fuel_fills ordered by date desc, limited to one', async () => {
      const client = fakeClient([]);

      await new PostgresAnalysisQuery(client).latestFuelFill();

      const [call] = client.calls;
      expect(call.sql).toMatch(/FROM fuel_fills/i);
      expect(call.sql).toMatch(/ORDER BY date DESC/i);
      expect(call.sql).toMatch(/LIMIT 1/i);
    });

    it('returns null when there are no fills', async () => {
      const result = await new PostgresAnalysisQuery(fakeClient([])).latestFuelFill();
      expect(result).toBeNull();
    });

    it('converts NUMERIC liters_added to a number', async () => {
      const client = fakeClient([
        {
          id: 1,
          client_uuid: null,
          date: '2025-12-23',
          gauge_percent_before: 22,
          liters_added: '487.90',
          liters_before_fill: '220',
          price_per_liter: '1.40',
          discount: '0.02',
          gst: '34.15',
          total_cost: '717.21',
          notes: null,
          created_at: '2025-12-23T18:00:00.000Z',
        },
      ]);

      const result = await new PostgresAnalysisQuery(client).latestFuelFill();

      expect(result?.litersAdded).toBe(487.9);
      expect(typeof result?.litersAdded).toBe('number');
    });
  });

  describe('fillsAddedAfter', () => {
    it('binds the date as a parameter, never into the SQL text', async () => {
      const client = fakeClient([{ total_added: null, count: '0' }]);

      await new PostgresAnalysisQuery(client).fillsAddedAfter('2026-02-24');

      const [call] = client.calls;
      expect(call.sql).toMatch(/date > \$1/);
      expect(call.params).toEqual(['2026-02-24']);
    });

    /** SUM over zero rows is NULL; COUNT is 0. The two must not be confused. */
    it('reports no fills as null total and zero count, not zero total', async () => {
      const client = fakeClient([{ total_added: null, count: '0' }]);

      const result = await new PostgresAnalysisQuery(client).fillsAddedAfter('2026-02-24');

      expect(result.totalAdded).toBeNull();
      expect(result.count).toBe(0);
    });

    it('converts the summed NUMERIC string to a number', async () => {
      const client = fakeClient([{ total_added: '150.50', count: '2' }]);

      const result = await new PostgresAnalysisQuery(client).fillsAddedAfter('2026-02-24');

      expect(result.totalAdded).toBe(150.5);
      expect(result.count).toBe(2);
    });
  });

  describe('fillsBetweenInclusive', () => {
    it('uses an inclusive range bound on both ends as bound parameters', async () => {
      const client = fakeClient([{ total_liters: null, total_cost: null, count: '0' }]);

      await new PostgresAnalysisQuery(client).fillsBetweenInclusive('2025-01-01', '2025-03-31');

      const [call] = client.calls;
      expect(call.sql).toMatch(/date >= \$1/);
      expect(call.sql).toMatch(/date <= \$2/);
      expect(call.params).toEqual(['2025-01-01', '2025-03-31']);
    });

    it('converts summed NUMERIC strings to numbers', async () => {
      const client = fakeClient([{ total_liters: '511.70', total_cost: '717.21', count: '1' }]);

      const result = await new PostgresAnalysisQuery(client).fillsBetweenInclusive(
        '2025-01-01',
        '2025-03-31',
      );

      expect(result.totalLiters).toBe(511.7);
      expect(result.totalCost).toBe(717.21);
      expect(result.count).toBe(1);
    });

    it('keeps an empty period as null totals rather than zero', async () => {
      const client = fakeClient([{ total_liters: null, total_cost: null, count: '0' }]);

      const result = await new PostgresAnalysisQuery(client).fillsBetweenInclusive(
        '2025-01-01',
        '2025-03-31',
      );

      expect(result.totalLiters).toBeNull();
      expect(result.totalCost).toBeNull();
    });
  });

  describe('hddBetweenExclusive', () => {
    /**
     * Matches the original route's `date > ? AND date <= ?` exactly: exclusive
     * of the fill/reading day itself, inclusive of the later boundary, so two
     * adjacent periods never double-count the boundary day.
     */
    it('excludes the from date and includes the to date', async () => {
      const client = fakeClient([{ total_hdd: null, days: '0' }]);

      await new PostgresAnalysisQuery(client).hddBetweenExclusive('2025-12-23', '2026-02-24');

      const [call] = client.calls;
      expect(call.sql).toMatch(/date > \$1/);
      expect(call.sql).toMatch(/date <= \$2/);
    });

    it('converts the summed NUMERIC string to a number', async () => {
      const client = fakeClient([{ total_hdd: '1218.40', days: '28' }]);

      const result = await new PostgresAnalysisQuery(client).hddBetweenExclusive(
        '2025-12-23',
        '2026-02-24',
      );

      expect(result.totalHdd).toBe(1218.4);
      expect(result.days).toBe(28);
    });

    it('reports a period with no weather rows as null rather than 0', async () => {
      const client = fakeClient([{ total_hdd: null, days: '0' }]);

      const result = await new PostgresAnalysisQuery(client).hddBetweenExclusive(
        '2025-12-23',
        '2026-02-24',
      );

      expect(result.totalHdd).toBeNull();
      expect(result.days).toBe(0);
    });
  });

  describe('totalHddAllTime', () => {
    it('queries with no date bound at all', async () => {
      const client = fakeClient([{ total_hdd: null }]);

      await new PostgresAnalysisQuery(client).totalHddAllTime();

      const [call] = client.calls;
      expect(call.sql).not.toMatch(/WHERE/i);
      expect(call.params ?? []).toEqual([]);
    });

    it('returns null rather than 0 when there is no weather data at all', async () => {
      const result = await new PostgresAnalysisQuery(fakeClient([{ total_hdd: null }])).totalHddAllTime();
      expect(result).toBeNull();
    });

    it('converts the summed NUMERIC string to a number', async () => {
      const result = await new PostgresAnalysisQuery(
        fakeClient([{ total_hdd: '4200.60' }]),
      ).totalHddAllTime();

      expect(result).toBe(4200.6);
    });
  });

  describe('weatherSummaryForEfficiency', () => {
    it('binds both bounds as inclusive parameters', async () => {
      const client = fakeClient([
        {
          days: '0',
          total_hdd: null,
          avg_hdd: null,
          avg_temp: null,
          min_temp: null,
          max_temp: null,
        },
      ]);

      await new PostgresAnalysisQuery(client).weatherSummaryForEfficiency(
        '2025-01-01',
        '2025-03-31',
      );

      const [call] = client.calls;
      expect(call.sql).toMatch(/date >= \$1/);
      expect(call.sql).toMatch(/date <= \$2/);
      expect(call.params).toEqual(['2025-01-01', '2025-03-31']);
    });

    /**
     * AVG(hdd) is NOT the same number as SUM(hdd)/COUNT(*) when any row in the
     * range has a null hdd — AVG ignores those rows in its own denominator,
     * COUNT(*) does not. This is why the method exists rather than deriving
     * avg_hdd_per_day from totalHdd and dayCount elsewhere.
     */
    it('converts every NUMERIC/aggregate string to a number, independently', async () => {
      const client = fakeClient([
        {
          days: '31',
          total_hdd: '1178.5',
          avg_hdd: '38.02',
          avg_temp: '-20.02',
          min_temp: '-35.4',
          max_temp: '-4.1',
        },
      ]);

      const result = await new PostgresAnalysisQuery(client).weatherSummaryForEfficiency(
        '2025-01-01',
        '2025-01-31',
      );

      expect(result).toEqual({
        days: 31,
        totalHdd: 1178.5,
        avgHdd: 38.02,
        avgTemp: -20.02,
        minTemp: -35.4,
        maxTemp: -4.1,
      });
    });

    it('keeps an empty period as null aggregates and zero days', async () => {
      const client = fakeClient([
        {
          days: '0',
          total_hdd: null,
          avg_hdd: null,
          avg_temp: null,
          min_temp: null,
          max_temp: null,
        },
      ]);

      const result = await new PostgresAnalysisQuery(client).weatherSummaryForEfficiency(
        '2025-01-01',
        '2025-01-31',
      );

      expect(result.days).toBe(0);
      expect(result.totalHdd).toBeNull();
      expect(result.avgHdd).toBeNull();
    });
  });
});
