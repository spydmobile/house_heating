import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  createAnalysisRouter,
  type AnalysisFillsStore,
  type AnalysisReadingsStore,
  type AnalysisWeatherStore,
  type ForecastProvider,
} from './createAnalysisRouter';
import type { FuelFill } from '../repositories/PostgresFuelFillRepository';
import type { GaugeReading } from '../repositories/PostgresGaugeReadingRepository';

/**
 * Route tests against fake stores, same approach as createFillsRouter.test.ts:
 * real HTTP through real Express, no database. These pin the HTTP contract —
 * status codes, validation, and the arithmetic that was previously inline in
 * the sqlite route — not the SQL, which belongs to PostgresAnalysisQuery.
 */

const fill: FuelFill = {
  id: 1,
  clientUuid: null,
  date: '2025-12-23',
  gaugePercentBefore: 22,
  litersAdded: 487.9,
  litersBeforeFill: 220,
  pricePerLiter: 1.4,
  discount: 0.02,
  gst: 34.15,
  totalCost: 717.21,
  notes: null,
  createdAt: '2025-12-23T18:00:00.000Z',
};

const reading: GaugeReading = {
  id: 1,
  clientUuid: null,
  date: '2026-01-15',
  gaugePercent: 50,
  notes: null,
  createdAt: '2026-01-15T00:00:00.000Z',
};

function fakeFills(overrides: Partial<AnalysisFillsStore> = {}): AnalysisFillsStore {
  return {
    list: async () => [fill],
    latest: async () => fill,
    addedAfter: async () => ({ totalAdded: null, count: 0 }),
    between: async () => ({ totalLiters: null, totalCost: null, count: 0 }),
    ...overrides,
  };
}

function fakeReadings(overrides: Partial<AnalysisReadingsStore> = {}): AnalysisReadingsStore {
  return {
    latest: async () => reading,
    // Added when AnalysisReadingsStore gained list(): /predictions builds
    // consumption periods from consecutive readings now, instead of running on
    // a hardcoded efficiency. A single reading forms no period, so these tests
    // exercise the refusal path — which is the intended behaviour, not a gap.
    list: async () => [reading],
    ...overrides,
  };
}

function fakeWeather(overrides: Partial<AnalysisWeatherStore> = {}): AnalysisWeatherStore {
  return {
    hddBetweenExclusive: async () => ({ totalHdd: null, days: 0 }),
    summaryForEfficiency: async () => ({
      days: 0,
      totalHdd: null,
      avgHdd: null,
      avgTemp: null,
      minTemp: null,
      maxTemp: null,
    }),
    totalHddAllTime: async () => null,
    ...overrides,
  };
}

function fakeForecast(overrides: Partial<ForecastProvider> = {}): ForecastProvider {
  return {
    fetchForecast: async () => ({ forecast: [], avg_hdd_per_day: 25 }),
    ...overrides,
  };
}

function appWith(deps: {
  fills?: AnalysisFillsStore;
  readings?: AnalysisReadingsStore;
  weather?: AnalysisWeatherStore;
  forecast?: ForecastProvider;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/analysis',
    createAnalysisRouter({
      fills: deps.fills ?? fakeFills(),
      readings: deps.readings ?? fakeReadings(),
      weather: deps.weather ?? fakeWeather(),
      forecast: deps.forecast ?? fakeForecast(),
    }),
  );
  return app;
}

describe('analysis router', () => {
  describe('GET /current', () => {
    it('reports no readings rather than throwing', async () => {
      const response = await request(
        appWith({ readings: fakeReadings({ latest: async () => null }) }),
      ).get('/api/analysis/current');

      expect(response.status).toBe(200);
      expect(response.body.error).toBeTruthy();
    });

    it('returns tank status built from the latest reading and fill', async () => {
      const response = await request(appWith({})).get('/api/analysis/current');

      expect(response.status).toBe(200);
      expect(response.body.tank.reading_percent).toBe(50);
      expect(response.body.tank.capacity).toBe(1000);
    });

    /**
     * A gauge reading of 0 is a value from the real data (see createFillsRouter
     * tests) — it must flow straight through as a tank reading of 0%, not be
     * treated as "no reading".
     */
    it('treats a gauge reading of 0 as a real value, not a missing one', async () => {
      const response = await request(
        appWith({ readings: fakeReadings({ latest: async () => ({ ...reading, gaugePercent: 0 }) }) }),
      ).get('/api/analysis/current');

      expect(response.status).toBe(200);
      expect(response.body.tank.reading_percent).toBe(0);
    });

    it('computes efficiency since fill when weather data covers the period', async () => {
      const response = await request(
        appWith({
          fills: fakeFills({ latest: async () => ({ ...fill, date: '2026-01-01' }) }),
          weather: fakeWeather({
            hddBetweenExclusive: async (from) =>
              from === '2026-01-01' ? { totalHdd: 400, days: 14 } : { totalHdd: null, days: 0 },
          }),
        }),
      ).get('/api/analysis/current');

      expect(response.status).toBe(200);
      expect(response.body.efficiency.current_l_per_hdd).not.toBeNull();
    });
  });

  /**
 * A qualifying consumption period: two readings a fortnight apart, with weather
 * for every day of it and no fill inside.
 *
 * /predictions now measures efficiency from periods like this rather than
 * running on a hardcoded 0.4, and REFUSES when none qualifies. The two forecast
 * tests below are about forecast handling, not about efficiency, so they are
 * given a period that qualifies — their assertions are unchanged.
 */
const olderReading: GaugeReading = {
  id: 0,
  clientUuid: null,
  date: '2026-01-01',
  gaugePercent: 60,
  notes: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const qualifyingPeriod = {
  readings: fakeReadings({ list: async () => [reading, olderReading] }),
  weather: fakeWeather({
    hddBetweenExclusive: async () => ({ totalHdd: 500, days: 14 }),
  }),
};

describe('GET /predictions', () => {
    it('reports no readings rather than throwing', async () => {
      const response = await request(
        appWith({ readings: fakeReadings({ latest: async () => null }) }),
      ).get('/api/analysis/predictions');

      expect(response.status).toBe(200);
      expect(response.body.error).toBeTruthy();
    });

    it('falls back to typical HDD scenarios when the forecast fetch fails', async () => {
      const response = await request(
        appWith({
          ...qualifyingPeriod,
          forecast: fakeForecast({
            fetchForecast: async () => {
              throw new Error('network unreachable');
            },
          }),
        }),
      ).get('/api/analysis/predictions');

      expect(response.status).toBe(200);
      expect(response.body.forecast).toBeNull();
      expect(response.body.scenarios.length).toBeGreaterThan(0);
    });

    it('includes the forecast when the fetch succeeds', async () => {
      const response = await request(
        appWith({
          ...qualifyingPeriod,
          forecast: fakeForecast({
            fetchForecast: async () => ({
              forecast: [{ date: '2026-02-01', max_temp: -10, min_temp: -20, mean_temp: -15, hdd: 33 }],
              avg_hdd_per_day: 33,
            }),
          }),
        }),
      ).get('/api/analysis/predictions');

      expect(response.status).toBe(200);
      expect(response.body.forecast.days).toHaveLength(1);
    });
  });

  describe('GET /efficiency', () => {
    it('400s when neither a period nor a from/to range is given', async () => {
      const response = await request(appWith({})).get('/api/analysis/efficiency');
      expect(response.status).toBe(400);
    });

    it('resolves the q1_2025 preset to its fixed date range', async () => {
      const weatherSummary = vi.fn(async () => ({
        days: 90,
        totalHdd: 3420,
        avgHdd: 38,
        avgTemp: -20,
        minTemp: -40,
        maxTemp: 2,
      }));

      const response = await request(
        appWith({ weather: fakeWeather({ summaryForEfficiency: weatherSummary }) }),
      ).get('/api/analysis/efficiency?period=q1_2025');

      expect(response.status).toBe(200);
      expect(weatherSummary).toHaveBeenCalledWith('2025-01-01', '2025-03-31');
      expect(response.body.weather.total_hdd).toBe(3420);
    });

    it('accepts an explicit from/to range', async () => {
      const response = await request(appWith({})).get(
        '/api/analysis/efficiency?from=2026-01-01&to=2026-01-31',
      );

      expect(response.status).toBe(200);
      expect(response.body.period).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    });

    /** Postgres rejects a malformed date as a type error; that must become a 400, not a 500. */
    it('400s a malformed explicit date rather than letting it reach the database', async () => {
      const response = await request(appWith({})).get(
        '/api/analysis/efficiency?from=2026-02-30&to=2026-03-01',
      );

      expect(response.status).toBe(400);
    });

    it('reports null efficiency rather than a fabricated number when there is no HDD data', async () => {
      const response = await request(
        appWith({
          fills: fakeFills({ between: async () => ({ totalLiters: 500, totalCost: 700, count: 1 }) }),
          weather: fakeWeather({
            summaryForEfficiency: async () => ({
              days: 0,
              totalHdd: null,
              avgHdd: null,
              avgTemp: null,
              minTemp: null,
              maxTemp: null,
            }),
          }),
        }),
      ).get('/api/analysis/efficiency?from=2026-01-01&to=2026-01-31');

      expect(response.status).toBe(200);
      expect(response.body.efficiency.liters_per_hdd).toBeNull();
    });

    it('computes efficiency when both fuel and weather totals are present', async () => {
      const response = await request(
        appWith({
          fills: fakeFills({ between: async () => ({ totalLiters: 500, totalCost: 700, count: 1 }) }),
          weather: fakeWeather({
            summaryForEfficiency: async () => ({
              days: 31,
              totalHdd: 1000,
              avgHdd: 32.3,
              avgTemp: -14,
              minTemp: -30,
              maxTemp: 0,
            }),
          }),
        }),
      ).get('/api/analysis/efficiency?from=2026-01-01&to=2026-01-31');

      expect(response.status).toBe(200);
      expect(response.body.efficiency.liters_per_hdd).toBe(0.5);
    });
  });

  describe('GET /costs', () => {
    it('totals fills and reports cost per HDD using the all-time weather total', async () => {
      const response = await request(
        appWith({
          fills: fakeFills({
            list: async () => [
              { ...fill, litersAdded: 500, totalCost: 700 },
              { ...fill, id: 2, litersAdded: 500, totalCost: 700 },
            ],
          }),
          weather: fakeWeather({ totalHddAllTime: async () => 2000 }),
        }),
      ).get('/api/analysis/costs');

      expect(response.status).toBe(200);
      expect(response.body.totals.liters).toBe(1000);
      expect(response.body.totals.cost).toBe(1400);
      expect(response.body.averages.cost_per_hdd).toBe(0.7);
    });

    it('reports null cost per HDD rather than a fabricated number when there is no weather data at all', async () => {
      const response = await request(
        appWith({ weather: fakeWeather({ totalHddAllTime: async () => null }) }),
      ).get('/api/analysis/costs');

      expect(response.status).toBe(200);
      expect(response.body.averages.cost_per_hdd).toBeNull();
    });

    it('reports zero totals rather than throwing when there are no fills at all', async () => {
      const response = await request(appWith({ fills: fakeFills({ list: async () => [] }) })).get(
        '/api/analysis/costs',
      );

      expect(response.status).toBe(200);
      expect(response.body.totals.liters).toBe(0);
      expect(response.body.totals.fills).toBe(0);
    });
  });

  /**
   * A rejected promise inside an async Express 4 handler does not reach the
   * error middleware — it hangs the request rather than 500ing. One test per
   * route is enough to pin the wrapper is applied everywhere.
   */
  describe('store failure', () => {
    it('/current returns 500 rather than hanging', async () => {
      const response = await request(
        appWith({
          readings: fakeReadings({
            latest: async () => {
              throw new Error('connection terminated unexpectedly');
            },
          }),
        }),
      ).get('/api/analysis/current');

      expect(response.status).toBe(500);
    });

    it('/predictions returns 500 rather than hanging', async () => {
      const response = await request(
        appWith({
          readings: fakeReadings({
            latest: async () => {
              throw new Error('connection terminated unexpectedly');
            },
          }),
        }),
      ).get('/api/analysis/predictions');

      expect(response.status).toBe(500);
    });

    it('/efficiency returns 500 rather than hanging', async () => {
      const response = await request(
        appWith({
          weather: fakeWeather({
            summaryForEfficiency: async () => {
              throw new Error('connection terminated unexpectedly');
            },
          }),
        }),
      ).get('/api/analysis/efficiency?period=q1_2025');

      expect(response.status).toBe(500);
    });

    it('/costs returns 500 rather than hanging', async () => {
      const response = await request(
        appWith({
          fills: fakeFills({
            list: async () => {
              throw new Error('connection terminated unexpectedly');
            },
          }),
        }),
      ).get('/api/analysis/costs');

      expect(response.status).toBe(500);
    });
  });
});
