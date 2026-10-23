import { describe, it, expect } from 'vitest';
import { PostgresFuelFillRepository } from './PostgresFuelFillRepository';
import type { QueryClient } from './QueryClient';

/**
 * The fills repository is the one the offline queue writes through, so its
 * idempotency is load-bearing.
 *
 * Honest limit, stated rather than implied: a fake client cannot prove
 * idempotency. That is enforced by the UNIQUE constraint in migration 001 and
 * is only truly demonstrated against a real Postgres. What these tests DO prove
 * is that the adapter asks for the conflict handling at all, and that the
 * snake_case row coming back becomes a correct domain object — a mapping bug
 * here would silently produce fills with undefined amounts, which is exactly
 * the class of fault that corrupts the ROI quietly.
 */

interface Recorded {
  sql: string;
  params?: unknown[];
}

function fakeClient(rows: unknown[] = []): QueryClient & { calls: Recorded[] } {
  const calls: Recorded[] = [];

  return {
    calls,
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

const dbRow = {
  id: 7,
  client_uuid: '11111111-2222-3333-4444-555555555555',
  date: '2026-02-24',
  gauge_percent_before: 12.5,
  liters_added: '511.70',
  liters_before_fill: '125.00',
  price_per_liter: '1.4590',
  discount: '0.0200',
  gst: '25.59',
  total_cost: '537.29',
  notes: 'TDC Contracting',
  created_at: '2026-02-24T18:00:00.000Z',
};

describe('PostgresFuelFillRepository', () => {
  describe('save', () => {
    it('upserts on client_uuid so a retried offline flush cannot duplicate a fill', async () => {
      const client = fakeClient([dbRow]);
      const repo = new PostgresFuelFillRepository(client);

      await repo.save({
        clientUuid: '11111111-2222-3333-4444-555555555555',
        date: '2026-02-24',
        gaugePercentBefore: 12.5,
        litersAdded: 511.7,
        litersBeforeFill: 125,
        pricePerLiter: 1.459,
        discount: 0.02,
        gst: 25.59,
        totalCost: 537.29,
        notes: 'TDC Contracting',
      });

      const [call] = client.calls;

      expect(call.sql).toMatch(/INSERT INTO fuel_fills/i);
      expect(call.sql).toMatch(/ON CONFLICT\s*\(\s*client_uuid\s*\)/i);
      expect(call.sql).toMatch(/RETURNING/i);
    });

    it('passes the client uuid as a parameter rather than interpolating it', async () => {
      const client = fakeClient([dbRow]);
      const repo = new PostgresFuelFillRepository(client);

      await repo.save({
        clientUuid: '11111111-2222-3333-4444-555555555555',
        date: '2026-02-24',
        gaugePercentBefore: 12.5,
        litersAdded: 511.7,
        litersBeforeFill: 125,
        pricePerLiter: 1.459,
        discount: 0.02,
        gst: 25.59,
        totalCost: 537.29,
        notes: null,
      });

      const [call] = client.calls;

      expect(call.params).toContain('11111111-2222-3333-4444-555555555555');
      expect(call.sql).not.toContain('11111111-2222-3333-4444-555555555555');
    });

    it('returns the saved fill as a domain object', async () => {
      const client = fakeClient([dbRow]);
      const repo = new PostgresFuelFillRepository(client);

      const saved = await repo.save({
        clientUuid: '11111111-2222-3333-4444-555555555555',
        date: '2026-02-24',
        gaugePercentBefore: 12.5,
        litersAdded: 511.7,
        litersBeforeFill: 125,
        pricePerLiter: 1.459,
        discount: 0.02,
        gst: 25.59,
        totalCost: 537.29,
        notes: 'TDC Contracting',
      });

      expect(saved.id).toBe(7);
      expect(saved.litersAdded).toBe(511.7);
      expect(saved.totalCost).toBe(537.29);
    });
  });

  describe('row mapping', () => {
    /**
     * `pg` returns NUMERIC as a STRING, not a number — it does that deliberately,
     * because a NUMERIC can exceed what a JS number represents exactly. Left
     * unconverted, `liters_added` would arrive as "511.70" and arithmetic on it
     * would silently concatenate instead of adding. This is the single most
     * likely quiet defect in the whole SQLite-to-Postgres move.
     */
    it('converts NUMERIC strings to numbers', async () => {
      const client = fakeClient([dbRow]);
      const repo = new PostgresFuelFillRepository(client);

      const [fill] = await repo.list();

      expect(fill.litersAdded).toBe(511.7);
      expect(fill.pricePerLiter).toBe(1.459);
      expect(fill.discount).toBe(0.02);
      expect(fill.totalCost).toBe(537.29);
      expect(typeof fill.litersAdded).toBe('number');
    });

    it('preserves null for an absent optional value instead of coercing it to zero', async () => {
      const client = fakeClient([{ ...dbRow, liters_before_fill: null, notes: null }]);
      const repo = new PostgresFuelFillRepository(client);

      const [fill] = await repo.list();

      expect(fill.litersBeforeFill).toBeNull();
      expect(fill.notes).toBeNull();
    });
  });

  describe('list', () => {
    it('orders by date descending', async () => {
      const client = fakeClient([dbRow]);
      const repo = new PostgresFuelFillRepository(client);

      await repo.list();

      expect(client.calls[0].sql).toMatch(/ORDER BY date DESC/i);
    });
  });

  describe('findById', () => {
    it('returns null when no row matches, rather than undefined', async () => {
      const client = fakeClient([]);
      const repo = new PostgresFuelFillRepository(client);

      expect(await repo.findById(999)).toBeNull();
    });
  });
});
