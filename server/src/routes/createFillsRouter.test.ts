import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFillsRouter, type FuelFillStore } from './createFillsRouter';
import type { FuelFill, NewFuelFill } from '../repositories/PostgresFuelFillRepository';

/**
 * Route tests against a fake store.
 *
 * The router takes its store as an argument, so these exercise real HTTP
 * through real Express without a database. What they pin down is the HTTP
 * contract — status codes, validation, and what gets handed to the store — not
 * the SQL, which is the repository's business.
 */

const existing: FuelFill = {
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
  notes: 'TDC Contracting',
  createdAt: '2025-12-23T18:00:00.000Z',
};

function fakeStore(overrides: Partial<FuelFillStore> = {}) {
  const saved: NewFuelFill[] = [];

  const store: FuelFillStore & { saved: NewFuelFill[] } = {
    saved,
    async list() {
      return [existing];
    },
    async findById(id: number) {
      return id === existing.id ? existing : null;
    },
    async save(fill: NewFuelFill) {
      saved.push(fill);
      return { ...existing, ...fill, id: existing.id } as FuelFill;
    },
    async deleteById(id: number) {
      return id === existing.id;
    },
    ...overrides,
  };

  return store;
}

function appWith(store: FuelFillStore) {
  const app = express();
  app.use(express.json());
  app.use('/api/fills', createFillsRouter({ fills: store }));
  return app;
}

const validBody = {
  date: '2026-02-24',
  gauge_percent_before: 12.5,
  liters_added: 511.7,
  price_per_liter: 1.459,
};

describe('fills router', () => {
  describe('GET /', () => {
    it('returns the fills', async () => {
      const response = await request(appWith(fakeStore())).get('/api/fills');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].litersAdded).toBe(487.9);
    });
  });

  describe('GET /:id', () => {
    it('returns a fill', async () => {
      const response = await request(appWith(fakeStore())).get('/api/fills/1');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(1);
    });

    it('404s a missing fill', async () => {
      const response = await request(appWith(fakeStore())).get('/api/fills/999');

      expect(response.status).toBe(404);
    });

    /**
     * SQLite would accept 'abc' as a bind value and quietly match nothing, so
     * a typo looked like a missing record. Postgres rejects it as a type error
     * instead, which would surface as a 500. Neither is right: it is a bad
     * request and must say so.
     */
    it('400s a non-numeric id rather than letting it reach the database', async () => {
      const response = await request(appWith(fakeStore())).get('/api/fills/abc');

      expect(response.status).toBe(400);
    });
  });

  describe('POST /', () => {
    it('creates a fill and returns 201', async () => {
      const response = await request(appWith(fakeStore()))
        .post('/api/fills')
        .send(validBody);

      expect(response.status).toBe(201);
    });

    it('computes litres before fill and the cost breakdown rather than trusting the client', async () => {
      const store = fakeStore();

      await request(appWith(store)).post('/api/fills').send(validBody);

      const [saved] = store.saved;

      expect(saved.litersBeforeFill).toBeGreaterThan(0);
      expect(saved.gst).toBeGreaterThan(0);
      expect(saved.totalCost).toBeGreaterThan(0);
    });

    /**
     * The offline queue's whole protection rests on this uuid reaching the
     * store. If the route dropped it, every retried flush would insert a new
     * fill and the upsert would never fire.
     */
    it('passes the client uuid through to the store', async () => {
      const store = fakeStore();

      await request(appWith(store))
        .post('/api/fills')
        .send({ ...validBody, client_uuid: '11111111-2222-3333-4444-555555555555' });

      expect(store.saved[0].clientUuid).toBe('11111111-2222-3333-4444-555555555555');
    });

    it('rejects a malformed client uuid instead of passing it to the database', async () => {
      const response = await request(appWith(fakeStore()))
        .post('/api/fills')
        .send({ ...validBody, client_uuid: 'not-a-uuid' });

      expect(response.status).toBe(400);
    });

    it.each([
      ['date', { ...validBody, date: undefined }],
      ['gauge_percent_before', { ...validBody, gauge_percent_before: undefined }],
      ['liters_added', { ...validBody, liters_added: undefined }],
      ['price_per_liter', { ...validBody, price_per_liter: undefined }],
    ])('400s when %s is missing', async (_field, body) => {
      const response = await request(appWith(fakeStore())).post('/api/fills').send(body);

      expect(response.status).toBe(400);
    });

    /**
     * A gauge reading of zero is the value that broke the real 2026-02-24 row:
     * stored as 0.0 with an empty litres-before, which is not credible and
     * breaks the consumption arithmetic. Zero must be ACCEPTED as a number
     * here — rejecting it would be wrong — but it must not be mistaken for
     * absence, which is what a falsy check does.
     */
    it('accepts a gauge reading of 0 as a value rather than treating it as missing', async () => {
      const response = await request(appWith(fakeStore()))
        .post('/api/fills')
        .send({ ...validBody, gauge_percent_before: 0 });

      expect(response.status).toBe(201);
    });
  });

  describe('DELETE /:id', () => {
    it('returns 204 when a fill was removed', async () => {
      const response = await request(appWith(fakeStore())).delete('/api/fills/1');

      expect(response.status).toBe(204);
    });

    it('404s when nothing was removed', async () => {
      const response = await request(appWith(fakeStore())).delete('/api/fills/999');

      expect(response.status).toBe(404);
    });
  });

  /**
   * A rejected promise inside an async Express 4 handler does NOT reach the
   * error middleware — it becomes an unhandled rejection and the request hangs
   * until the client times out. This is the single most likely new fault from
   * the sync-to-async move, so it gets a test per verb.
   */
  describe('store failure', () => {
    const exploding = {
      async list(): Promise<FuelFill[]> {
        throw new Error('connection terminated unexpectedly');
      },
      async findById(): Promise<FuelFill | null> {
        throw new Error('connection terminated unexpectedly');
      },
      async save(): Promise<FuelFill> {
        throw new Error('connection terminated unexpectedly');
      },
      async deleteById(): Promise<boolean> {
        throw new Error('connection terminated unexpectedly');
      },
    };

    it('returns 500 rather than hanging when the list query fails', async () => {
      const response = await request(appWith(exploding)).get('/api/fills');

      expect(response.status).toBe(500);
    });

    it('returns 500 rather than hanging when the save fails', async () => {
      const response = await request(appWith(exploding))
        .post('/api/fills')
        .send(validBody);

      expect(response.status).toBe(500);
    });
  });
});
