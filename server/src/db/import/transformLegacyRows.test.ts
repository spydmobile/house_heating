import { describe, it, expect } from 'vitest';
import {
  transformFuelFill,
  transformGaugeReading,
  transformWeatherDay,
  transformHvacReport,
  type LegacyFuelFill,
} from './transformLegacyRows';

/**
 * Transforms rows read out of the legacy SQLite database into the shape the
 * Postgres repositories expect.
 *
 * This runs ONCE against real data — six fuel fills, seven gauge readings, 109
 * weather days, fifteen HVAC reports. That is the entire history the window
 * replacement ROI is computed from, so the rules here are deliberately
 * conservative:
 *
 * - A row that cannot be transformed FAILS. It is never silently dropped or
 *   coerced, because a missing fill would quietly change the measurement.
 * - Implausible values are carried across UNCHANGED. The 2026-02-24 fill
 *   records gauge_percent_before = 0.0 with an empty liters_before_fill, which
 *   is not credible — but repairing data during a migration invents history,
 *   and the audit of that row is a separate, visible decision.
 * - `client_uuid` is null for every imported row. These predate the PWA; they
 *   were never submitted from an offline queue and must not pretend they were.
 */

const legacyFill: LegacyFuelFill = {
  id: 5,
  date: '2025-12-23',
  gauge_percent_before: 22,
  liters_added: 487.9,
  liters_before_fill: 220,
  price_per_liter: 1.4,
  discount: 0.02,
  gst: 34.15,
  total_cost: 717.21,
  notes: 'TDC Contracting #342630',
  created_at: '2025-12-23 18:00:00',
};

describe('transformFuelFill', () => {
  it('preserves the original id so a re-run cannot duplicate the row', () => {
    expect(transformFuelFill(legacyFill).id).toBe(5);
  });

  it('maps the measured values across unchanged', () => {
    const fill = transformFuelFill(legacyFill);

    expect(fill.date).toBe('2025-12-23');
    expect(fill.litersAdded).toBe(487.9);
    expect(fill.totalCost).toBe(717.21);
    expect(fill.notes).toBe('TDC Contracting #342630');
  });

  /** These rows predate the PWA; they were never queued offline. */
  it('leaves client_uuid null', () => {
    expect(transformFuelFill(legacyFill).clientUuid).toBeNull();
  });

  /**
   * THE 2026-02-24 ROW. gauge_percent_before 0.0 with an empty
   * liters_before_fill is not credible, and it breaks the consumption
   * arithmetic. It is carried across EXACTLY as recorded — repairing data
   * during a migration invents history, and auditing that row is a separate
   * decision somebody should make deliberately.
   */
  it('carries an implausible row across unchanged rather than repairing it', () => {
    const implausible = transformFuelFill({
      ...legacyFill,
      id: 6,
      date: '2026-02-24',
      gauge_percent_before: 0,
      liters_before_fill: null,
    });

    expect(implausible.gaugePercentBefore).toBe(0);
    expect(implausible.litersBeforeFill).toBeNull();
  });

  it('keeps a genuine zero rather than turning it into null', () => {
    const fill = transformFuelFill({ ...legacyFill, discount: 0, gst: 0 });

    expect(fill.discount).toBe(0);
    expect(fill.gst).toBe(0);
  });

  describe('it refuses rather than guessing', () => {
    it.each([
      ['a malformed date', { date: '23/12/2025' }],
      ['an impossible date', { date: '2026-02-30' }],
      ['an empty date', { date: '' }],
    ])('throws on %s, naming the row', (_case, override) => {
      expect(() => transformFuelFill({ ...legacyFill, ...override })).toThrowError(
        /fuel_fills.*id 5/i,
      );
    });

    it('throws when a required measurement is missing', () => {
      expect(() =>
        transformFuelFill({ ...legacyFill, liters_added: null as never }),
      ).toThrowError(/liters_added/i);
    });

    it('throws when a numeric field is not a number', () => {
      expect(() =>
        transformFuelFill({ ...legacyFill, price_per_liter: 'M' as never }),
      ).toThrowError(/price_per_liter/i);
    });
  });

  /** SQLite stored timestamps as 'YYYY-MM-DD HH:MM:SS' with no zone. */
  it('normalises a space-separated timestamp into something Postgres parses', () => {
    expect(transformFuelFill(legacyFill).createdAt).toMatch(
      /^2025-12-23T18:00:00/,
    );
  });
});

describe('transformGaugeReading', () => {
  it('preserves the id and leaves client_uuid null', () => {
    const reading = transformGaugeReading({
      id: 3,
      date: '2025-12-29',
      gauge_percent: 86.5,
      notes: null,
      created_at: '2025-12-29 20:00:00',
    });

    expect(reading.id).toBe(3);
    expect(reading.clientUuid).toBeNull();
    expect(reading.gaugePercent).toBe(86.5);
  });

  it('accepts a gauge of 0 as a value', () => {
    const reading = transformGaugeReading({
      id: 4,
      date: '2026-02-24',
      gauge_percent: 0,
      notes: null,
      created_at: '2026-02-24 10:00:00',
    });

    expect(reading.gaugePercent).toBe(0);
  });
});

describe('transformWeatherDay', () => {
  it('maps a day and keeps its recorded source', () => {
    const day = transformWeatherDay({
      id: 11,
      date: '2026-01-12',
      max_temp: -9.8,
      min_temp: -17,
      mean_temp: -13.4,
      hdd: 31.4,
      source: 'auto',
      created_at: '2026-01-13 09:00:00',
    });

    expect(day.date).toBe('2026-01-12');
    expect(day.hdd).toBe(31.4);
    expect(day.source).toBe('auto');
  });

  /**
   * A temperature of null is a real state in this data — a day recorded with
   * no reading. It must stay null and must not become 0, which is an ordinary
   * Fort Smith temperature and would read as a measurement.
   */
  it('keeps a missing temperature null rather than zero', () => {
    const day = transformWeatherDay({
      id: 12,
      date: '2026-01-13',
      max_temp: null,
      min_temp: null,
      mean_temp: null,
      hdd: null,
      source: 'manual',
      created_at: '2026-01-14 09:00:00',
    });

    expect(day.maxTemp).toBeNull();
    expect(day.hdd).toBeNull();
  });
});

describe('transformHvacReport', () => {
  it('maps a monthly report', () => {
    const report = transformHvacReport({
      id: 14,
      year: 2026,
      month: 1,
      total_runtime_hours: 327,
      avg_cycle_minutes: 18.4,
      avg_outdoor_temp: -21.2,
      avg_indoor_temp: 21.5,
      avg_setpoint: 22,
      notes: null,
      created_at: '2026-02-01 00:00:00',
    });

    expect(report.year).toBe(2026);
    expect(report.totalRuntimeHours).toBe(327);
  });

  it('rejects a month outside 1-12 rather than importing it', () => {
    expect(() =>
      transformHvacReport({
        id: 15,
        year: 2026,
        month: 13,
        total_runtime_hours: 10,
        avg_cycle_minutes: null,
        avg_outdoor_temp: null,
        avg_indoor_temp: null,
        avg_setpoint: null,
        notes: null,
        created_at: '2026-02-01 00:00:00',
      }),
    ).toThrowError(/month/i);
  });

  /** 0 runtime hours is a real summer month, not a missing value. */
  it('accepts zero runtime hours', () => {
    const report = transformHvacReport({
      id: 16,
      year: 2025,
      month: 7,
      total_runtime_hours: 0,
      avg_cycle_minutes: null,
      avg_outdoor_temp: 17.1,
      avg_indoor_temp: null,
      avg_setpoint: null,
      notes: null,
      created_at: '2025-08-01 00:00:00',
    });

    expect(report.totalRuntimeHours).toBe(0);
  });
});
