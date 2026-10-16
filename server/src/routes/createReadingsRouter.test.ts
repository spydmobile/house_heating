import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createReadingsRouter, type GaugeReadingStore } from './createReadingsRouter';
import type { GaugeReading, NewGaugeReading } from '../repositories/PostgresGaugeReadingRepository';

/**
 * Route tests against a fake store.
 *
 * Mirrors createFillsRouter.test.ts: the router takes its store as an
 * argument, so these exercise real HTTP through real Express without a
 * database. What they pin down is the HTTP contract, not the SQL.
 */

const existing: GaugeReading = {
  id: 1,
  clientUuid: null,
  date: '2025-12-23',
  gaugePercent: 42,
  notes: 'routine check',
  createdAt: '2025-12-23T18:00:00.000Z',
};

function fakeStore(overrides: Partial<GaugeReadingStore> = {}) {
  const saved: NewGaugeReading[] = [];

  const store: GaugeReadingStore & { saved: NewGaugeReading[] } = {
    saved,
    async list() {
      return [existing];
    },
    async findById(id: number) {
      return id === existing.id ? existing : null;
    },
    async save(reading: NewGaugeReading) {
      saved.push(reading);
      return { ...existing, ...reading, id: existing.id } as GaugeReading;
    },
    async update(id: number, edit: { date: string; gaugePercent: number; notes: string | null }) {
      return id === existing.id ? ({ ...existing, ...edit } as GaugeReading) : null;
    },
    async deleteById(id: number) {
      return id === existing.id;
    },
    ...overrides,
  };

  return store;
}

function appWith(store: GaugeReadingStore) {
  const app = express();
  app.use(express.json());
  // The enrichment on GET / spans readings and weather, so the router now takes
  // a narrow weather port too. These tests are about the readings contract, so
  // the period lookup reports no weather data.
  app.use(
    '/api/readings',
    createReadingsRouter({
      readings: store,
      weather: { async hddForPeriod() { return null; } },
    }),
  );
  return app;
}

const validBody = {
  date: '2026-02-24',
  gauge_percent: 12.5,
};

describe('readings router', () => {
  describe('GET /', () => {
    it('returns the readings', async () => {
      const response = await request(appWith(fakeStore())).get('/api/readings');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].gaugePercent).toBe(42);
    });
  });

  describe('GET /:id', () => {
    it('returns a reading', async () => {
      const response = await request(appWith(fakeStore())).get('/api/readings/1');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(1);
    });

    it('404s a missing reading', async () => {
      const response = await request(appWith(fakeStore())).get('/api/readings/999');

      expect(response.status).toBe(404);
    });

    it('400s a non-numeric id rather than letting it reach the database', async () => {
      const response = await request(appWith(fakeStore())).get('/api/readings/abc');

      expect(response.status).toBe(400);
    });
  });

  describe('POST /', () => {
    it('creates a reading and returns 201', async () => {
      const response = await request(appWith(fakeStore()))
        .post('/api/readings')
        .send(validBody);

      expect(response.status).toBe(201);
    });

    it('passes the client uuid through to the store', async () => {
      const store = fakeStore();

      await request(appWith(store))
        .post('/api/readings')
        .send({ ...validBody, client_uuid: '11111111-2222-3333-4444-555555555555' });

      expect(store.saved[0].clientUuid).toBe('11111111-2222-3333-4444-555555555555');
    });

    it('rejects a malformed client uuid instead of passing it to the database', async () => {
      const response = await request(appWith(fakeStore()))
        .post('/api/readings')
        .send({ ...validBody, client_uuid: 'not-a-uuid' });

      expect(response.status).toBe(400);
    });

    it.each([
      ['date', { ...validBody, date: undefined }],
      ['gauge_percent', { ...validBody, gauge_percent: undefined }],
    ])('400s when %s is missing', async (_field, body) => {
      const response = await request(appWith(fakeStore())).post('/api/readings').send(body);

      expect(response.status).toBe(400);
    });

    /**
     * A gauge reading of zero is a value, not an absence. The fills router
     * has the same test for the same reason; this one guards the same
     * failure for the field it most directly protects.
     */
    it('accepts a gauge reading of 0 as a value rather than treating it as missing', async () => {
      const response = await request(appWith(fakeStore()))
        .post('/api/readings')
        .send({ ...validBody, gauge_percent: 0 });

      expect(response.status).toBe(201);
    });
  });

  describe('DELETE /:id', () => {
    it('returns 204 when a reading was removed', async () => {
      const response = await request(appWith(fakeStore())).delete('/api/readings/1');

      expect(response.status).toBe(204);
    });

    it('404s when nothing was removed', async () => {
      const response = await request(appWith(fakeStore())).delete('/api/readings/999');

      expect(response.status).toBe(404);
    });
  });

  /**
   * A rejected promise inside an async Express 4 handler does NOT reach the
   * error middleware — it becomes an unhandled rejection and the request
   * hangs until the client times out.
   */
  describe('store failure', () => {
    const exploding = {
      async list(): Promise<GaugeReading[]> {
        throw new Error('connection terminated unexpectedly');
      },
      async findById(): Promise<GaugeReading | null> {
        throw new Error('connection terminated unexpectedly');
      },
      async save(): Promise<GaugeReading> {
        throw new Error('connection terminated unexpectedly');
      },
      async update(): Promise<GaugeReading | null> {
        throw new Error('connection terminated unexpectedly');
      },
      async deleteById(): Promise<boolean> {
        throw new Error('connection terminated unexpectedly');
      },
    };

    it('returns 500 rather than hanging when the list query fails', async () => {
      const response = await request(appWith(exploding)).get('/api/readings');

      expect(response.status).toBe(500);
    });

    it('returns 500 rather than hanging when the save fails', async () => {
      const response = await request(appWith(exploding))
        .post('/api/readings')
        .send(validBody);

      expect(response.status).toBe(500);
    });
  });
});
