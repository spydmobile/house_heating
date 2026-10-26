import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createFillsRouter, type FuelFillStore } from './createFillsRouter';
import type { FuelFill, NewFuelFill } from '../repositories/PostgresFuelFillRepository';

/**
 * An UNKNOWN gauge reading must be recordable as unknown.
 *
 * The real 2026-02-24 fill reads gauge_percent_before = 0 with the note "Gauge
 * before fill unknown". Nobody measured an empty tank; the column was NOT NULL,
 * so the only way to file the delivery was to type a number. That is a
 * fabricated measurement produced by the schema, with the explanation hidden in
 * a free-text field no query will ever consult — the silent-default rule broken
 * at the only layer that could have refused.
 *
 * So: absent means absent. It is stored as NULL, liters_before_fill cannot be
 * estimated from it and is NULL too, and the fill is still accepted — the
 * delivery happened and its litres and cost are real regardless.
 *
 * A gauge reading of 0 remains a legitimate VALUE and must keep working.
 */

const existing: FuelFill = {
  id: 1,
  clientUuid: null,
  date: '2026-02-24',
  gaugePercentBefore: 45,
  litersAdded: 511.7,
  litersBeforeFill: 450,
  pricePerLiter: 1.435,
  discount: 10.23,
  gst: 36.2,
  totalCost: 760.26,
  notes: null,
  createdAt: '2026-02-24T18:00:00.000Z',
};

function harness() {
  const saved: NewFuelFill[] = [];

  const store = {
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
    async deleteById() {
      return true;
    },
  } as unknown as FuelFillStore & { saved: NewFuelFill[] };

  const app = express();
  app.use(express.json());
  app.use('/api/fills', createFillsRouter({ fills: store }));

  return { app, store };
}

describe('POST /api/fills with an unknown gauge reading', () => {
  it('accepts the fill and stores the gauge reading as null', async () => {
    const { app, store } = harness();

    const response = await request(app).post('/api/fills').send({
      date: '2026-02-24',
      gauge_percent_before: null,
      liters_added: 511.7,
      price_per_liter: 1.435,
      notes: 'Gauge before fill unknown.',
    });

    expect(response.status).toBe(201);
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0].gaugePercentBefore).toBeNull();
  });

  it('does not invent liters_before_fill when the gauge is unknown', async () => {
    const { app, store } = harness();

    await request(app).post('/api/fills').send({
      date: '2026-02-24',
      gauge_percent_before: null,
      liters_added: 511.7,
      price_per_liter: 1.435,
    });

    // estimateLiters(0) would be 0 litres before the fill — a claim that the
    // tank was empty, which is the fabrication this whole change removes.
    expect(store.saved[0].litersBeforeFill).toBeNull();
  });

  it('still treats a gauge reading of 0 as a real measurement', async () => {
    const { app, store } = harness();

    const response = await request(app).post('/api/fills').send({
      date: '2026-02-24',
      gauge_percent_before: 0,
      liters_added: 511.7,
      price_per_liter: 1.435,
    });

    expect(response.status).toBe(201);
    expect(store.saved[0].gaugePercentBefore).toBe(0);
    expect(store.saved[0].litersBeforeFill).toBe(0);
  });

  it('still refuses a fill with no litres added', async () => {
    const { app } = harness();

    const response = await request(app).post('/api/fills').send({
      date: '2026-02-24',
      gauge_percent_before: null,
      price_per_liter: 1.435,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/liters_added/);
  });
});
