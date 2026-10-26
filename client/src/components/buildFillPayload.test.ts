import { describe, it, expect } from 'vitest';

import { buildFillPayload } from './buildFillPayload';

/**
 * The form's one real decision, extracted so it can be tested.
 *
 * Client tests here are pure logic — there is no jsdom and no testing-library —
 * so the alternative was adding a test framework to cover a decision that does
 * not belong in a component anyway.
 *
 * What it must get right: a BLANK gauge field means the gauge was not read, and
 * must be omitted rather than sent as NaN or 0. `parseFloat('')` is NaN, and
 * JSON.stringify turns NaN into null — so the old code happened to transmit
 * something null-shaped by accident, while the input's `required` attribute
 * stopped anyone from ever doing it. Accident plus prohibition is not a
 * contract.
 *
 * And 0 remains a real reading: a tank genuinely near empty must be recordable.
 */
describe('buildFillPayload', () => {
  const base = {
    date: '2026-02-24',
    gaugeBefore: '',
    litersAdded: '511.7',
    pricePerLiter: '1.435',
    notes: '',
  };

  it('omits the gauge reading entirely when the field is blank', () => {
    const payload = buildFillPayload(base);

    expect('gauge_percent_before' in payload).toBe(false);
  });

  it('never sends NaN for the gauge reading', () => {
    const payload = buildFillPayload(base) as unknown as Record<string, unknown>;

    expect(Number.isNaN(payload.gauge_percent_before)).toBe(false);
  });

  it('sends a gauge reading of 0 as a real value', () => {
    const payload = buildFillPayload({ ...base, gaugeBefore: '0' });

    expect(payload.gauge_percent_before).toBe(0);
  });

  it('sends a normal gauge reading through', () => {
    const payload = buildFillPayload({ ...base, gaugeBefore: '45.5' });

    expect(payload.gauge_percent_before).toBe(45.5);
  });

  it('treats whitespace as blank rather than as a reading', () => {
    const payload = buildFillPayload({ ...base, gaugeBefore: '   ' });

    expect('gauge_percent_before' in payload).toBe(false);
  });

  it('carries the litres, price and date it was given', () => {
    const payload = buildFillPayload({ ...base, gaugeBefore: '45' });

    expect(payload.date).toBe('2026-02-24');
    expect(payload.liters_added).toBe(511.7);
    expect(payload.price_per_liter).toBe(1.435);
  });

  it('omits empty notes rather than sending an empty string', () => {
    expect('notes' in buildFillPayload(base)).toBe(false);
  });
});
