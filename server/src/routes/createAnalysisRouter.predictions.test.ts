import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  createAnalysisRouter,
  type AnalysisRouterDependencies,
} from './createAnalysisRouter';
import type { GaugeReading } from '../repositories/PostgresGaugeReadingRepository';

/**
 * `/predictions` must REFUSE rather than predict from a constant.
 *
 * It previously ran on `const efficiency = 0.4` with a TODO saying the real
 * calculation was never written — in a file that records 0.191 L/HDD as the
 * old-windows baseline. Every refill date it produced came from a number more
 * than double the project's own baseline.
 *
 * Franco's ruling, 2026-10-20: refuse to predict and say why.
 */

function reading(date: string, gaugePercent: number): GaugeReading {
  return {
    id: Number(date.replaceAll('-', '')),
    clientUuid: null,
    date,
    gaugePercent,
    notes: null,
    createdAt: `${date}T12:00:00.000Z`,
  };
}

/** Two readings a fortnight apart, 10% of a 1000 L tank consumed. */
const twoReadings = [reading('2025-12-29', 80), reading('2025-12-15', 90)];

function deps(overrides: {
  readings?: GaugeReading[];
  hdd?: { totalHdd: number | null; days: number };
  fillsInPeriod?: number;
} = {}): AnalysisRouterDependencies {
  const list = overrides.readings ?? twoReadings;
  const hdd = overrides.hdd ?? { totalHdd: 523.6, days: 14 };
  const fillCount = overrides.fillsInPeriod ?? 0;

  return {
    readings: {
      async latest() {
        return list[0] ?? null;
      },
      async list() {
        return list;
      },
    },
    fills: {
      async list() {
        return [];
      },
      async latest() {
        return null;
      },
      async addedAfter() {
        return { totalAdded: null, count: 0 };
      },
      async between() {
        return { totalLiters: null, totalCost: null, count: fillCount };
      },
    },
    weather: {
      async hddBetweenExclusive() {
        return hdd;
      },
      async summaryForEfficiency() {
        return {
          days: 0,
          totalHdd: null,
          avgHdd: null,
          avgTemp: null,
          minTemp: null,
          maxTemp: null,
        };
      },
      async totalHddAllTime() {
        return null;
      },
    },
    forecast: {
      async fetchForecast() {
        return { forecast: [], avg_hdd_per_day: 30 };
      },
    },
  } as AnalysisRouterDependencies;
}

function appWith(dependencies: AnalysisRouterDependencies) {
  const app = express();
  app.use(express.json());
  app.use('/api/analysis', createAnalysisRouter(dependencies));

  // Mirrors createApp's JSON error handler. Without it Express answers with an
  // HTML 500 and the real cause never reaches the test output, which turns a
  // one-line bug into a hunt.
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error('[test] route error:', error);
      res.status(500).json({ error: String(error) });
    },
  );

  return app;
}

describe('GET /predictions — measured efficiency or nothing', () => {
  describe('when a complete period is available', () => {
    it('predicts using the MEASURED efficiency, not 0.4', async () => {
      const response = await request(appWith(deps())).get('/api/analysis/predictions');

      expect(response.status).toBe(200);
      // 100 L over 523.6 HDD = 0.191, the baseline figure — not 0.4.
      expect(response.body.efficiency.measured).toBeCloseTo(0.191, 3);
      expect(response.body.efficiency.used).toBeCloseTo(0.191, 3);
      expect(response.body.efficiency.used).not.toBeCloseTo(0.4, 2);
    });

    it('reports the evidence behind the figure', async () => {
      const response = await request(appWith(deps())).get('/api/analysis/predictions');

      expect(response.body.efficiency.source).toMatch(/measured/i);
      expect(response.body.efficiency.qualifying_periods).toBe(1);
      expect(response.body.efficiency.total_hdd).toBeCloseTo(523.6, 1);
    });

    it('still produces a refill prediction', async () => {
      const response = await request(appWith(deps())).get('/api/analysis/predictions');

      expect(response.body.forecast_based_prediction).not.toBeNull();
      expect(
        response.body.forecast_based_prediction.estimated_refill_date,
      ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('when no period qualifies, it refuses', () => {
    /** January 2026: six days of thirty-one. The inflation case. */
    it('refuses on incomplete weather coverage and names it', async () => {
      const response = await request(
        appWith(deps({ hdd: { totalHdd: 188.2, days: 6 } })),
      ).get('/api/analysis/predictions');

      expect(response.status).toBe(200);
      expect(response.body.forecast_based_prediction).toBeNull();
      expect(response.body.efficiency.measured).toBeNull();
      expect(response.body.efficiency.reason).toMatch(/weather/i);
    });

    it('refuses when a fill falls inside the period', async () => {
      const response = await request(appWith(deps({ fillsInPeriod: 1 }))).get(
        '/api/analysis/predictions',
      );

      expect(response.body.forecast_based_prediction).toBeNull();
      expect(response.body.efficiency.reason).toMatch(/fill/i);
    });

    it('refuses when there is only one reading, so no period exists', async () => {
      const response = await request(
        appWith(deps({ readings: [reading('2025-12-29', 80)] })),
      ).get('/api/analysis/predictions');

      expect(response.body.forecast_based_prediction).toBeNull();
      expect(response.body.efficiency.reason).toBeTruthy();
    });

    it('refuses when the period has no weather at all', async () => {
      const response = await request(
        appWith(deps({ hdd: { totalHdd: null, days: 0 } })),
      ).get('/api/analysis/predictions');

      expect(response.body.forecast_based_prediction).toBeNull();
      expect(response.body.efficiency.measured).toBeNull();
    });

    /** THE GUARD. No constant may reappear here, labelled or otherwise. */
    it('emits no efficiency figure at all when refusing', async () => {
      const response = await request(
        appWith(deps({ hdd: { totalHdd: 188.2, days: 6 } })),
      ).get('/api/analysis/predictions');

      expect(response.body.efficiency.used).toBeNull();
      expect(JSON.stringify(response.body)).not.toContain('0.4');
    });

    /**
     * Refusing to predict is not refusing to report. The tank level is
     * observed, not derived from efficiency, so it still comes back.
     */
    it('still reports the observed tank level', async () => {
      const response = await request(
        appWith(deps({ hdd: { totalHdd: 188.2, days: 6 } })),
      ).get('/api/analysis/predictions');

      expect(response.body.current_tank.as_of).toBe('2025-12-29');
      expect(response.body.current_tank.percent).toBe(80);
    });

    it('omits scenario predictions, which are all efficiency-driven', async () => {
      const response = await request(
        appWith(deps({ hdd: { totalHdd: 188.2, days: 6 } })),
      ).get('/api/analysis/predictions');

      expect(response.body.scenarios).toEqual([]);
    });
  });
});
