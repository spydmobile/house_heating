import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  createReadingsRouter,
  type GaugeReadingStore,
  type ReadingsWeatherStore,
} from './createReadingsRouter';
import type { GaugeReading } from '../repositories/PostgresGaugeReadingRepository';

/**
 * Restores the two things the old sqlite route did that the first conversion
 * pass correctly left out rather than inventing SQL for: the cross-table
 * enrichment on `GET /`, and `PUT /:id`.
 *
 * The enrichment carries `liters_per_hdd` — L/HDD, the metric the window
 * replacement question is asked in — so losing it in the move would have
 * removed the project's primary measurement from the API while every test
 * stayed green.
 */

const readings: GaugeReading[] = [
  {
    id: 2,
    clientUuid: null,
    date: '2025-12-29',
    gaugePercent: 80,
    notes: null,
    createdAt: '2025-12-29T18:00:00.000Z',
  },
  {
    id: 1,
    clientUuid: null,
    date: '2025-12-15',
    gaugePercent: 90,
    notes: null,
    createdAt: '2025-12-15T18:00:00.000Z',
  },
];

function fakeReadings(overrides: Partial<GaugeReadingStore> = {}): GaugeReadingStore {
  return {
    async list() {
      return readings;
    },
    async findById(id: number) {
      return readings.find((r) => r.id === id) ?? null;
    },
    async save(reading) {
      return { ...readings[0], ...reading } as GaugeReading;
    },
    async update(id: number, edit) {
      return id === 2 ? ({ ...readings[0], ...edit } as GaugeReading) : null;
    },
    async deleteById(id: number) {
      return id === 2;
    },
    ...overrides,
  };
}

function fakeWeather(hdd: number | null): ReadingsWeatherStore & { asked: string[][] } {
  const asked: string[][] = [];

  return {
    asked,
    async hddForPeriod(from: string, to: string) {
      asked.push([from, to]);
      return hdd;
    },
  };
}

function appWith(
  readingsStore: GaugeReadingStore,
  weatherStore: ReadingsWeatherStore,
) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/readings',
    createReadingsRouter({ readings: readingsStore, weather: weatherStore }),
  );
  return app;
}

describe('readings router — enrichment and edit', () => {
  describe('GET / enrichment', () => {
    it('returns consumption and L/HDD alongside each reading', async () => {
      const response = await request(
        appWith(fakeReadings(), fakeWeather(523.6)),
      ).get('/api/readings');

      expect(response.status).toBe(200);

      const [latest] = response.body;

      expect(latest.estLiters).toBe(800);
      expect(latest.daysSinceLast).toBe(14);
      expect(latest.litersUsed).toBe(100);
      expect(latest.litersPerDay).toBe(7.14);
      expect(latest.hddPeriod).toBe(523.6);
      expect(latest.litersPerHdd).toBe(0.191);
    });

    it('asks the weather store for the period between consecutive readings', async () => {
      const weather = fakeWeather(100);

      await request(appWith(fakeReadings(), weather)).get('/api/readings');

      expect(weather.asked).toEqual([['2025-12-15', '2025-12-29']]);
    });

    /**
     * No weather for the period must leave the efficiency absent rather than
     * dividing by an invented zero.
     */
    it('leaves efficiency null when the period has no weather data', async () => {
      const response = await request(appWith(fakeReadings(), fakeWeather(null))).get(
        '/api/readings',
      );

      expect(response.body[0].hddPeriod).toBeNull();
      expect(response.body[0].litersPerHdd).toBeNull();
    });

    it('returns 500 rather than hanging when the weather lookup fails', async () => {
      const exploding: ReadingsWeatherStore = {
        async hddForPeriod() {
          throw new Error('connection terminated unexpectedly');
        },
      };

      const response = await request(appWith(fakeReadings(), exploding)).get(
        '/api/readings',
      );

      expect(response.status).toBe(500);
    });
  });

  describe('PUT /:id', () => {
    it('updates a reading', async () => {
      const response = await request(appWith(fakeReadings(), fakeWeather(null)))
        .put('/api/readings/2')
        .send({ date: '2025-12-30', gauge_percent: 78, notes: 'corrected' });

      expect(response.status).toBe(200);
      expect(response.body.gaugePercent).toBe(78);
    });

    it('404s when no reading has that id', async () => {
      const response = await request(appWith(fakeReadings(), fakeWeather(null)))
        .put('/api/readings/999')
        .send({ date: '2025-12-30', gauge_percent: 78 });

      expect(response.status).toBe(404);
    });

    it('400s a non-numeric id', async () => {
      const response = await request(appWith(fakeReadings(), fakeWeather(null)))
        .put('/api/readings/abc')
        .send({ date: '2025-12-30', gauge_percent: 78 });

      expect(response.status).toBe(400);
    });

    it('400s when a required field is missing', async () => {
      const response = await request(appWith(fakeReadings(), fakeWeather(null)))
        .put('/api/readings/2')
        .send({ notes: 'only notes' });

      expect(response.status).toBe(400);
    });

    it('accepts a gauge reading of 0 as a value rather than treating it as missing', async () => {
      const response = await request(appWith(fakeReadings(), fakeWeather(null)))
        .put('/api/readings/2')
        .send({ date: '2025-12-30', gauge_percent: 0 });

      expect(response.status).toBe(200);
    });

    it('returns 500 rather than hanging when the update fails', async () => {
      const response = await request(
        appWith(
          fakeReadings({
            async update() {
              throw new Error('connection terminated unexpectedly');
            },
          }),
          fakeWeather(null),
        ),
      )
        .put('/api/readings/2')
        .send({ date: '2025-12-30', gauge_percent: 78 });

      expect(response.status).toBe(500);
    });
  });
});
