import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWeatherRouter, type WeatherStore } from './createWeatherRouter';
import type { WeatherDay, NewWeatherDay } from '../repositories/PostgresWeatherRepository';

/**
 * Route tests against a fake store.
 *
 * Weather has no client_uuid — it is written by the server from Environment
 * Canada, never queued offline on a phone — so unlike the fills/readings
 * routers there is no uuid passthrough or validation to pin down here.
 */

const existing: WeatherDay = {
  id: 1,
  date: '2025-12-23',
  maxTemp: -18,
  minTemp: -27,
  meanTemp: -22.5,
  hdd: 40.5,
  source: 'environment-canada',
  createdAt: '2025-12-23T18:00:00.000Z',
};

function fakeStore(overrides: Partial<WeatherStore> = {}) {
  const saved: NewWeatherDay[] = [];

  const store: WeatherStore & { saved: NewWeatherDay[] } = {
    saved,
    async findRange(_from: string | null, _to: string | null) {
      return [existing];
    },
    async summary(_from: string, _to: string) {
      return {
        avgMeanTemp: -13.4,
        minTemp: -34.2,
        maxTemp: 4.1,
        totalHdd: 981.2,
        dayCount: 28,
      };
    },
    async deleteByDate(date: string) {
      return date === existing.date;
    },
    async findBetween(_from: string, _to: string) {
      return [existing];
    },
    async save(day: NewWeatherDay) {
      saved.push(day);
      return { ...existing, ...day, id: existing.id } as WeatherDay;
    },
    ...overrides,
  };

  return store;
}

function appWith(store: WeatherStore) {
  const app = express();
  app.use(express.json());
  app.use('/api/weather', createWeatherRouter({ weather: store }));
  return app;
}

describe('weather router', () => {
  describe('GET /', () => {
    it('returns weather for the given range', async () => {
      const response = await request(appWith(fakeStore())).get(
        '/api/weather?from=2025-12-01&to=2025-12-31',
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].hdd).toBe(40.5);
    });

    /**
     * REVISED 2026-10-16, with Franco's approval, and the reason matters.
     *
     * These three cases previously asserted a 400 — the first conversion pass
     * required both bounds, because the repository then exposed only
     * findBetween(from, to) and inventing SQL in the route was correctly
     * refused.
     *
     * That requirement was a LIVE REGRESSION, not a conservative choice. The
     * client's `getWeather(from?, to?)` builds an empty query string when
     * called with no arguments, and `Dashboard.tsx` calls it exactly that way,
     * so mandatory bounds would 400 the dashboard's weather panel.
     *
     * The repository now has `findRange` with optional bounds, so all four
     * shapes are valid requests. A MALFORMED bound is still a 400 — see
     * createWeatherRouter.restored.test.ts, which covers that and the rest of
     * the restored surface.
     */
    it('returns every day when no bounds are given, as the dashboard requests it', async () => {
      const response = await request(appWith(fakeStore())).get('/api/weather');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
    });

    it('accepts an end bound alone', async () => {
      const response = await request(appWith(fakeStore())).get(
        '/api/weather?to=2025-12-31',
      );

      expect(response.status).toBe(200);
    });

    it('accepts a start bound alone', async () => {
      const response = await request(appWith(fakeStore())).get(
        '/api/weather?from=2025-12-01',
      );

      expect(response.status).toBe(200);
    });

    it('still rejects a malformed bound', async () => {
      const response = await request(appWith(fakeStore())).get(
        '/api/weather?from=not-a-date',
      );

      expect(response.status).toBe(400);
    });
  });

  describe('POST /', () => {
    const validBody = { date: '2026-02-24', max_temp: -10, min_temp: -20 };

    it('creates a weather day and returns 201', async () => {
      const response = await request(appWith(fakeStore())).post('/api/weather').send(validBody);

      expect(response.status).toBe(201);
    });

    it('computes mean temp and hdd rather than trusting the client', async () => {
      const store = fakeStore();

      await request(appWith(store)).post('/api/weather').send(validBody);

      const [saved] = store.saved;

      expect(saved.meanTemp).toBe(-15);
      expect(saved.hdd).toBeGreaterThan(0);
      expect(saved.source).toBe('manual');
    });

    it.each([
      ['date', { ...validBody, date: undefined }],
      ['max_temp', { ...validBody, max_temp: undefined }],
      ['min_temp', { ...validBody, min_temp: undefined }],
    ])('400s when %s is missing', async (_field, body) => {
      const response = await request(appWith(fakeStore())).post('/api/weather').send(body);

      expect(response.status).toBe(400);
    });

    /**
     * A temperature of 0°C is an ordinary Fort Smith day, not an absent
     * value. Same failure mode the fills/readings routers guard against for
     * gauge readings, checked here for min_temp/max_temp instead.
     */
    it('accepts a temperature of 0 as a value rather than treating it as missing', async () => {
      const response = await request(appWith(fakeStore()))
        .post('/api/weather')
        .send({ ...validBody, max_temp: 0 });

      expect(response.status).toBe(201);
    });
  });

  /**
   * A rejected promise inside an async Express 4 handler does NOT reach the
   * error middleware — it becomes an unhandled rejection and the request
   * hangs until the client times out.
   */
  describe('store failure', () => {
    const exploding = {
      async findRange(): Promise<WeatherDay[]> {
        throw new Error('connection terminated unexpectedly');
      },
      async summary(): Promise<never> {
        throw new Error('connection terminated unexpectedly');
      },
      async deleteByDate(): Promise<boolean> {
        throw new Error('connection terminated unexpectedly');
      },
      async findBetween(): Promise<WeatherDay[]> {
        throw new Error('connection terminated unexpectedly');
      },
      async save(): Promise<WeatherDay> {
        throw new Error('connection terminated unexpectedly');
      },
    };

    it('returns 500 rather than hanging when the range query fails', async () => {
      const response = await request(appWith(exploding)).get(
        '/api/weather?from=2025-12-01&to=2025-12-31',
      );

      expect(response.status).toBe(500);
    });

    it('returns 500 rather than hanging when the save fails', async () => {
      const response = await request(appWith(exploding))
        .post('/api/weather')
        .send({ date: '2026-02-24', max_temp: -10, min_temp: -20 });

      expect(response.status).toBe(500);
    });
  });
});
