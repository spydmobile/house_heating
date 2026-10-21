import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  createHvacRouter,
  type HvacStore,
  type MonthlyEfficiencySource,
} from './createHvacRouter';
import type { HvacReport, NewHvacReport } from '../repositories/PostgresHvacReportRepository';
import type { MonthlyEfficiencyRow } from '../repositories/PostgresMonthlyEfficiencyQuery';

/**
 * HVAC routes.
 *
 * THE BUG THE OLD ROUTE WOULD HAVE TAKEN INTO POSTGRES: it scoped a month's
 * fuel with
 *
 *     const endDate = `${year}-${month}-31`
 *
 * for EVERY month. SQLite compares dates as strings, so '2026-02-31' silently
 * worked as an upper bound. Postgres parses DATE, rejects 2026-02-31 as a real
 * error, and the endpoint would have 500'd on any February. That is the good
 * case — the bad one is a month where the string compare quietly included or
 * excluded the wrong day.
 *
 * The month scoping is EXTRACT-based in the read model now, so no date string
 * is constructed at all.
 */

const report: HvacReport = {
  id: 14,
  year: 2026,
  month: 1,
  totalRuntimeHours: 327,
  avgCycleMinutes: 18.4,
  avgOutdoorTemp: -21.2,
  avgIndoorTemp: 21.5,
  avgSetpoint: 22,
  notes: null,
  createdAt: '2026-02-01T00:00:00.000Z',
};

const efficiencyRow: MonthlyEfficiencyRow = {
  ...report,
  fuelLiters: 511.7,
  totalHdd: 1218.4,
  weatherDays: 31,
};

function fakeStore(overrides: Partial<HvacStore> = {}) {
  const saved: NewHvacReport[] = [];

  const store: HvacStore & { saved: NewHvacReport[] } = {
    saved,
    async list() {
      return [report];
    },
    async findByMonth(year: number, month: number) {
      return year === 2026 && month === 1 ? report : null;
    },
    async save(incoming: NewHvacReport) {
      saved.push(incoming);
      return { ...report, ...incoming };
    },
    async deleteByMonth(year: number, month: number) {
      return year === 2026 && month === 1;
    },
    ...overrides,
  };

  return store;
}

function fakeEfficiency(rows: MonthlyEfficiencyRow[] = [efficiencyRow]): MonthlyEfficiencySource {
  return { async list() { return rows; } };
}

function appWith(
  store: HvacStore,
  efficiency: MonthlyEfficiencySource = fakeEfficiency(),
) {
  const app = express();
  app.use(express.json());
  app.use('/api/hvac', createHvacRouter({ hvac: store, efficiency }));
  return app;
}

const validBody = { year: 2026, month: 2, total_runtime_hours: 280 };

describe('hvac router', () => {
  describe('GET /', () => {
    it('returns reports enriched with the month fuel total', async () => {
      const response = await request(appWith(fakeStore())).get('/api/hvac');

      expect(response.status).toBe(200);
      expect(response.body[0].fuelLiters).toBe(511.7);
    });

    it('derives litres per runtime hour', async () => {
      const response = await request(appWith(fakeStore())).get('/api/hvac');

      // 511.7 / 327 = 1.565
      expect(response.body[0].litersPerRuntimeHour).toBeCloseTo(1.565, 3);
    });

    /**
     * No fuel recorded is not zero litres burned, and a runtime of zero cannot
     * be divided into. Both are null rather than 0.
     */
    it('reports null litres per hour when no fuel was recorded that month', async () => {
      const response = await request(
        appWith(fakeStore(), fakeEfficiency([{ ...efficiencyRow, fuelLiters: null }])),
      ).get('/api/hvac');

      expect(response.body[0].litersPerRuntimeHour).toBeNull();
      expect(response.body[0].fuelLiters).toBeNull();
    });

    it('reports null litres per hour when runtime was zero', async () => {
      const response = await request(
        appWith(
          fakeStore(),
          fakeEfficiency([{ ...efficiencyRow, totalRuntimeHours: 0 }]),
        ),
      ).get('/api/hvac');

      expect(response.body[0].litersPerRuntimeHour).toBeNull();
    });
  });

  describe('GET /:year/:month', () => {
    it('returns a report', async () => {
      const response = await request(appWith(fakeStore())).get('/api/hvac/2026/1');

      expect(response.status).toBe(200);
      expect(response.body.totalRuntimeHours).toBe(327);
    });

    it('404s a month with no report', async () => {
      const response = await request(appWith(fakeStore())).get('/api/hvac/2024/7');

      expect(response.status).toBe(404);
    });

    /**
     * Postgres rejects a non-numeric year as a type error, which surfaces as a
     * 500 and reads as the database being down.
     */
    it.each([
      ['year', '/api/hvac/abcd/1'],
      ['month', '/api/hvac/2026/jan'],
    ])('400s a non-numeric %s', async (_which, path) => {
      const response = await request(appWith(fakeStore())).get(path);

      expect(response.status).toBe(400);
    });

    it('400s a month outside 1-12 rather than querying for it', async () => {
      expect((await request(appWith(fakeStore())).get('/api/hvac/2026/13')).status).toBe(
        400,
      );
      expect((await request(appWith(fakeStore())).get('/api/hvac/2026/0')).status).toBe(
        400,
      );
    });
  });

  describe('POST /', () => {
    it('creates a report and returns 201', async () => {
      const response = await request(appWith(fakeStore()))
        .post('/api/hvac')
        .send(validBody);

      expect(response.status).toBe(201);
    });

    /**
     * A runtime of 0 hours is a real reading for a summer month. The original
     * guarded required fields with `!year || !month`, which also rejects a
     * legitimate zero on the numeric fields it checked that way.
     */
    it('accepts a runtime of 0 hours as a value', async () => {
      const response = await request(appWith(fakeStore()))
        .post('/api/hvac')
        .send({ year: 2025, month: 7, total_runtime_hours: 0 });

      expect(response.status).toBe(201);
    });

    /**
     * The original wrote optional numbers with `avg_cycle_minutes || null`,
     * turning a genuine 0 °C average outdoor temperature into NULL. In Fort
     * Smith 0 °C is an ordinary spring day.
     */
    it('stores an average temperature of 0 rather than converting it to null', async () => {
      const store = fakeStore();

      await request(appWith(store))
        .post('/api/hvac')
        .send({ ...validBody, avg_outdoor_temp: 0, avg_cycle_minutes: 0 });

      expect(store.saved[0].avgOutdoorTemp).toBe(0);
      expect(store.saved[0].avgCycleMinutes).toBe(0);
    });

    it.each([
      ['year', { month: 2, total_runtime_hours: 280 }],
      ['month', { year: 2026, total_runtime_hours: 280 }],
      ['total_runtime_hours', { year: 2026, month: 2 }],
    ])('400s when %s is missing', async (_field, body) => {
      const response = await request(appWith(fakeStore())).post('/api/hvac').send(body);

      expect(response.status).toBe(400);
    });

    it('400s an out-of-range month', async () => {
      const response = await request(appWith(fakeStore()))
        .post('/api/hvac')
        .send({ ...validBody, month: 13 });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /:year/:month', () => {
    it('returns 204 when a report was removed', async () => {
      const response = await request(appWith(fakeStore())).delete('/api/hvac/2026/1');

      expect(response.status).toBe(204);
    });

    it('404s when nothing was removed', async () => {
      const response = await request(appWith(fakeStore())).delete('/api/hvac/2024/7');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /analysis/efficiency', () => {
    it('is matched as a literal path, not as a year and month', async () => {
      const response = await request(appWith(fakeStore())).get(
        '/api/hvac/analysis/efficiency',
      );

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('reports litres per hour and litres per HDD for each month', async () => {
      const response = await request(appWith(fakeStore())).get(
        '/api/hvac/analysis/efficiency',
      );

      const [row] = response.body;

      expect(row.period).toBe('2026-01');
      expect(row.litersPerHour).toBeCloseTo(1.565, 3);
      expect(row.litersPerHdd).toBeCloseTo(0.42, 2);
    });

    /**
     * The weather-day count travels with the HDD total. An L/HDD from six days
     * of January and one from thirty-one look identical without it, and only
     * one of them is worth anything.
     */
    it('carries the weather-day count behind each HDD total', async () => {
      const response = await request(appWith(fakeStore())).get(
        '/api/hvac/analysis/efficiency',
      );

      expect(response.body[0].weatherDays).toBe(31);
    });

    it('reports null efficiency when the month has no weather', async () => {
      const response = await request(
        appWith(
          fakeStore(),
          fakeEfficiency([{ ...efficiencyRow, totalHdd: null, weatherDays: 0 }]),
        ),
      ).get('/api/hvac/analysis/efficiency');

      expect(response.body[0].litersPerHdd).toBeNull();
      expect(response.body[0].totalHdd).toBeNull();
    });
  });

  describe('store failure', () => {
    it('returns 500 rather than hanging', async () => {
      const response = await request(
        appWith(
          fakeStore({
            async findByMonth(): Promise<HvacReport | null> {
              throw new Error('connection terminated unexpectedly');
            },
          }),
        ),
      ).get('/api/hvac/2026/1');

      expect(response.status).toBe(500);
    });
  });
});
