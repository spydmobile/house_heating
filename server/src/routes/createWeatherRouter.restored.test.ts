import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWeatherRouter, type WeatherStore } from './createWeatherRouter';
import type {
  WeatherDay,
  WeatherSummary,
} from '../repositories/PostgresWeatherRepository';

/**
 * Restores the three weather endpoints the first conversion pass left out.
 *
 * `GET /` with no query parameters is the one that matters most: the client's
 * `getWeather(from?, to?)` builds an empty query string when called with no
 * arguments, and `Dashboard.tsx` calls it exactly that way. Requiring both
 * bounds would 400 the main dashboard's weather panel — a live regression, not
 * a hypothetical one.
 */

const day: WeatherDay = {
  id: 11,
  date: '2026-01-12',
  maxTemp: -9.8,
  minTemp: -17,
  meanTemp: -13.4,
  hdd: 31.4,
  source: 'climate-archive',
  createdAt: '2026-01-13T09:00:00.000Z',
};

const summary: WeatherSummary = {
  avgMeanTemp: -13.4,
  minTemp: -34.2,
  maxTemp: 4.1,
  totalHdd: 981.2,
  dayCount: 28,
};

function fakeStore(overrides: Partial<WeatherStore> = {}) {
  const ranges: (string | null)[][] = [];
  const deleted: string[] = [];

  const store: WeatherStore & {
    ranges: (string | null)[][];
    deleted: string[];
  } = {
    ranges,
    deleted,
    async findRange(from, to) {
      ranges.push([from, to]);
      return [day];
    },
    async findBetween() {
      return [day];
    },
    async summary() {
      return summary;
    },
    async deleteByDate(date: string) {
      deleted.push(date);
      return date === day.date;
    },
    async save() {
      return day;
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

describe('weather router — restored endpoints', () => {
  describe('GET / with optional bounds', () => {
    it('returns every day when no bounds are given, as the dashboard requests it', async () => {
      const store = fakeStore();

      const response = await request(appWith(store)).get('/api/weather');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(store.ranges).toEqual([[null, null]]);
    });

    it('treats an empty query string the same as no bounds', async () => {
      const store = fakeStore();

      const response = await request(appWith(store)).get('/api/weather?');

      expect(response.status).toBe(200);
      expect(store.ranges).toEqual([[null, null]]);
    });

    it('passes both bounds through when both are given', async () => {
      const store = fakeStore();

      await request(appWith(store)).get('/api/weather?from=2026-01-01&to=2026-01-31');

      expect(store.ranges).toEqual([['2026-01-01', '2026-01-31']]);
    });

    it('accepts a start bound alone', async () => {
      const store = fakeStore();

      await request(appWith(store)).get('/api/weather?from=2026-01-01');

      expect(store.ranges).toEqual([['2026-01-01', null]]);
    });

    it('accepts an end bound alone', async () => {
      const store = fakeStore();

      await request(appWith(store)).get('/api/weather?to=2026-01-31');

      expect(store.ranges).toEqual([[null, '2026-01-31']]);
    });

    /**
     * A malformed date must be refused here rather than handed to Postgres,
     * which rejects it as a type error and surfaces as a 500 — indistinguishable
     * from the database being down.
     */
    it.each(['not-a-date', '2026-13-01', '01-02-2026', '2026-1-1'])(
      '400s a malformed from bound (%s)',
      async (bad) => {
        const response = await request(appWith(fakeStore())).get(
          `/api/weather?from=${bad}`,
        );

        expect(response.status).toBe(400);
      },
    );

    it('400s a malformed to bound', async () => {
      const response = await request(appWith(fakeStore())).get(
        '/api/weather?to=yesterday',
      );

      expect(response.status).toBe(400);
    });
  });

  describe('GET /summary', () => {
    it('returns the aggregates with the day count that backs them', async () => {
      const response = await request(appWith(fakeStore())).get(
        '/api/weather/summary?from=2026-01-01&to=2026-01-31',
      );

      expect(response.status).toBe(200);
      expect(response.body.totalHdd).toBe(981.2);
      expect(response.body.dayCount).toBe(28);
    });

    /**
     * The summary route is a literal path and must not be swallowed by a
     * parameterised route. If route order regressed, this would be read as a
     * date and 400 or 404 instead.
     */
    it('is matched as a literal path, not as a date parameter', async () => {
      const response = await request(appWith(fakeStore())).get(
        '/api/weather/summary?from=2026-01-01&to=2026-01-31',
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('dayCount');
    });

    it('400s when a bound is missing, since an aggregate needs a range', async () => {
      const response = await request(appWith(fakeStore())).get('/api/weather/summary');

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /:date', () => {
    it('deletes a day and returns 204', async () => {
      const store = fakeStore();

      const response = await request(appWith(store)).delete('/api/weather/2026-01-12');

      expect(response.status).toBe(204);
      expect(store.deleted).toEqual(['2026-01-12']);
    });

    it('404s when no row had that date', async () => {
      const response = await request(appWith(fakeStore())).delete(
        '/api/weather/2020-01-01',
      );

      expect(response.status).toBe(404);
    });

    it('400s a malformed date rather than passing it to the database', async () => {
      const response = await request(appWith(fakeStore())).delete(
        '/api/weather/not-a-date',
      );

      expect(response.status).toBe(400);
    });
  });

  describe('store failure', () => {
    it('returns 500 rather than hanging when a range query fails', async () => {
      const response = await request(
        appWith(
          fakeStore({
            async findRange() {
              throw new Error('connection terminated unexpectedly');
            },
          }),
        ),
      ).get('/api/weather');

      expect(response.status).toBe(500);
    });

    it('returns 500 rather than hanging when a delete fails', async () => {
      const response = await request(
        appWith(
          fakeStore({
            async deleteByDate() {
              throw new Error('connection terminated unexpectedly');
            },
          }),
        ),
      ).delete('/api/weather/2026-01-12');

      expect(response.status).toBe(500);
    });
  });
});
