import { describe, it, expect } from 'vitest';
import { PostgresGaugeReadingRepository } from './PostgresGaugeReadingRepository';
import type { QueryClient } from './QueryClient';

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
  id: 3,
  client_uuid: '99999999-8888-7777-6666-555555555555',
  date: '2025-12-29',
  gauge_percent: 86.5,
  notes: 'before the cold snap',
  created_at: '2025-12-29T20:00:00.000Z',
};

describe('PostgresGaugeReadingRepository', () => {
  it('returns readings ordered by date descending', async () => {
    const client = fakeClient([dbRow]);
    const repo = new PostgresGaugeReadingRepository(client);

    const readings = await repo.list();

    expect(client.calls[0].sql).toMatch(/ORDER BY date DESC/i);
    expect(readings[0].gaugePercent).toBe(86.5);
  });

  /**
   * A gauge reading is logged at the tank, in the cold, with no network — the
   * same path as a fuel fill. So it needs the same idempotency: a retried flush
   * must not create a second reading for the same observation.
   */
  it('upserts on client_uuid so a retried offline flush cannot duplicate a reading', async () => {
    const client = fakeClient([dbRow]);
    const repo = new PostgresGaugeReadingRepository(client);

    await repo.save({
      clientUuid: '99999999-8888-7777-6666-555555555555',
      date: '2025-12-29',
      gaugePercent: 86.5,
      notes: null,
    });

    const [call] = client.calls;

    expect(call.sql).toMatch(/INSERT INTO gauge_readings/i);
    expect(call.sql).toMatch(/ON CONFLICT\s*\(\s*client_uuid\s*\)/i);
    expect(call.sql).toMatch(/RETURNING/i);
    expect(call.params).toContain('99999999-8888-7777-6666-555555555555');
  });

  it('returns null for a missing reading rather than undefined', async () => {
    const repo = new PostgresGaugeReadingRepository(fakeClient([]));

    expect(await repo.findById(404)).toBeNull();
  });

  it('reports whether a delete actually removed a row', async () => {
    expect(await new PostgresGaugeReadingRepository(fakeClient([])).deleteById(1)).toBe(
      false,
    );
    expect(
      await new PostgresGaugeReadingRepository(fakeClient([{ id: 1 }])).deleteById(1),
    ).toBe(true);
  });
});
