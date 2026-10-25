import { describe, it, expect } from 'vitest';

import { findShortfalls, describeShortfall } from './verifyImport.js';

/**
 * These tests exist because the original verification PASSED on a real partial
 * import, 2026-10-25. It compared a TABLE TOTAL to the sqlite row count:
 *
 *   78 imported legacy rows + 31 pre-existing synced rows = 109
 *   sqlite weather_data                                   = 109
 *
 * Both numbers were true. The comparison answered a different question than the
 * one it was built for, so ROLLBACK never fired and 31 days of weather were
 * silently dropped by ON CONFLICT (id) DO NOTHING.
 *
 * The fix is to compare the rows the import TRIED to write against the rows
 * actually present under those same keys — never against the table's total.
 */
describe('findShortfalls', () => {
  it('reports a shortfall when the table total hides missing rows', () => {
    // The real case: 109 legacy days attempted, only 78 of them present
    // afterwards, while the table itself holds 109 rows.
    const attempted = Array.from({ length: 109 }, (_, i) => `2025-09-24+${i}`);
    const present = attempted.slice(0, 78);

    const shortfalls = findShortfalls([
      { table: 'weather_data', attempted, present },
    ]);

    expect(shortfalls).toHaveLength(1);
    expect(shortfalls[0].table).toBe('weather_data');
    expect(shortfalls[0].attempted).toBe(109);
    expect(shortfalls[0].present).toBe(78);
    expect(shortfalls[0].missing).toHaveLength(31);
  });

  it('names which keys are missing, not merely how many', () => {
    const shortfalls = findShortfalls([
      {
        table: 'weather_data',
        attempted: ['2025-09-24', '2025-09-25', '2025-09-26'],
        present: ['2025-09-25'],
      },
    ]);

    expect(shortfalls[0].missing).toEqual(['2025-09-24', '2025-09-26']);
  });

  it('is silent when every attempted row is present', () => {
    expect(
      findShortfalls([
        { table: 'fuel_fills', attempted: ['1', '2'], present: ['1', '2'] },
      ]),
    ).toEqual([]);
  });

  it('ignores rows present that this import never attempted', () => {
    // The pre-existing synced rows are not this import's business. Counting
    // them is precisely the mistake that let the partial import commit.
    const shortfalls = findShortfalls([
      {
        table: 'weather_data',
        attempted: ['2025-09-24'],
        present: ['2025-09-24', '2026-10-01', '2026-10-02'],
      },
    ]);

    expect(shortfalls).toEqual([]);
  });

  it('reports every short table rather than stopping at the first', () => {
    const shortfalls = findShortfalls([
      { table: 'fuel_fills', attempted: ['1'], present: [] },
      { table: 'gauge_readings', attempted: ['1'], present: ['1'] },
      { table: 'weather_data', attempted: ['2025-09-24'], present: [] },
    ]);

    expect(shortfalls.map((s) => s.table)).toEqual(['fuel_fills', 'weather_data']);
  });

  it('treats an empty attempt as nothing to verify', () => {
    expect(
      findShortfalls([{ table: 'hvac_reports', attempted: [], present: [] }]),
    ).toEqual([]);
  });
});

describe('describeShortfall', () => {
  it('samples the missing keys and counts the remainder', () => {
    const attempted = Array.from({ length: 109 }, (_, i) => `day-${i}`);

    const [shortfall] = findShortfalls([
      { table: 'weather_data', attempted, present: attempted.slice(31) },
    ]);

    const text = describeShortfall(shortfall);

    expect(text).toContain('weather_data: 78 of 109 attempted rows present');
    expect(text).toContain('missing 31');
    expect(text).toContain('day-0');
    expect(text).toContain('and 26 more');
  });
});
