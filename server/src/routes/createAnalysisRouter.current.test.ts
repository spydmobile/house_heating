import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  createAnalysisRouter,
  type AnalysisRouterDependencies,
} from './createAnalysisRouter';
import type { GaugeReading } from '../repositories/PostgresGaugeReadingRepository';
import type { FuelFill } from '../repositories/PostgresFuelFillRepository';

/**
 * `/current` projects the tank level FORWARD from the last gauge reading, by
 * subtracting efficiency x degree-days since that reading.
 *
 * It did that with `const efficiency = efficiencySinceFill || 0.4`, so whenever
 * recent efficiency could not be measured — which is most of the time, given
 * the weather holes — the projection silently ran on a constant more than
 * double the project's own 0.191 baseline, and reported it as
 * `efficiency_used` as though it had been measured.
 *
 * Franco's ruling, 2026-10-20: refuse to predict and say why. The OBSERVED
 * reading is still reported; only the derived projection is withheld.
 */

const reading: GaugeReading = {
  id: 1,
  clientUuid: null,
  date: '2026-01-15',
  gaugePercent: 50,
  notes: null,
  createdAt: '2026-01-15T00:00:00.000Z',
};

const fill: FuelFill = {
  id: 1,
  clientUuid: null,
  date: '2026-01-01',
  gaugePercentBefore: 20,
  litersAdded: 500,
  litersBeforeFill: 200,
  pricePerLiter: 1.4,
  discount: 0.02,
  gst: 34,
  totalCost: 714,
  notes: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** No measurable efficiency: no weather recorded for any period. */
function deps(
  overrides: { totalHdd?: number | null; days?: number } = {},
): AnalysisRouterDependencies {
  const totalHdd = overrides.totalHdd ?? null;
  const days = overrides.days ?? 0;

  return {
    readings: {
      async latest() {
        return reading;
      },
      async list() {
        return [reading];
      },
    },
    fills: {
      async list() {
        return [fill];
      },
      async latest() {
        return fill;
      },
      async addedAfter() {
        return { totalAdded: null, count: 0 };
      },
      async between() {
        return { totalLiters: null, totalCost: null, count: 0 };
      },
    },
    weather: {
      async hddBetweenExclusive() {
        return { totalHdd, days };
      },
      async summaryForEfficiency() {
        return {
          days,
          totalHdd,
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
  return app;
}

describe('GET /current — observed level always, projection only when measurable', () => {
  describe('when efficiency cannot be measured', () => {
    it('still reports the observed gauge reading', async () => {
      const response = await request(appWith(deps())).get('/api/analysis/current');

      expect(response.status).toBe(200);
      expect(response.body.tank.reading_percent).toBe(50);
      expect(response.body.tank.reading_liters).toBe(500);
      expect(response.body.tank.reading_date).toBe('2026-01-15');
    });

    /**
     * THE GUARD. `efficiency_used: 0.4` previously appeared in the response as
     * though it were a measurement. It must be absent, not defaulted.
     */
    it('reports no efficiency used, rather than 0.4', async () => {
      const response = await request(appWith(deps())).get('/api/analysis/current');

      expect(response.body.tank.projection.efficiency_used).toBeNull();
      expect(JSON.stringify(response.body.tank)).not.toContain('0.4');
    });

    it('withholds the forward projection and says why', async () => {
      const response = await request(appWith(deps())).get('/api/analysis/current');

      expect(response.body.tank.current_liters).toBeNull();
      expect(response.body.tank.current_percent).toBeNull();
      expect(response.body.tank.projection.reason).toBeTruthy();
    });

    it('withholds the refill prediction, which is entirely efficiency-driven', async () => {
      const response = await request(appWith(deps())).get('/api/analysis/current');

      expect(response.body.prediction).toBeNull();
    });

    it('still reports the baseline it compares against', async () => {
      const response = await request(appWith(deps())).get('/api/analysis/current');

      expect(response.body.efficiency.baseline_q1_2025).toBe(0.191);
    });
  });

  describe('when efficiency can be measured', () => {
    /** 300 L consumed since the fill over 1000 HDD = 0.3 L/HDD. */
    it('projects using the measured figure and reports it as used', async () => {
      const response = await request(
        appWith(deps({ totalHdd: 1000, days: 14 })),
      ).get('/api/analysis/current');

      expect(response.status).toBe(200);
      expect(response.body.tank.projection.efficiency_used).toBeGreaterThan(0);
      expect(response.body.tank.current_liters).not.toBeNull();
      expect(response.body.prediction).not.toBeNull();
    });
  });
});
