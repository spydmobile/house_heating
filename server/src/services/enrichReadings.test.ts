import { describe, it, expect } from 'vitest';
import { enrichReadings, type ReadingForEnrichment } from './enrichReadings';

/**
 * Consumption between consecutive gauge readings, and the L/HDD efficiency
 * that the whole window-replacement question is asked in.
 *
 * A PURE function: it is handed the readings and the HDD for each period, so
 * every edge case below is testable without a database. The original computed
 * this inline in routes/readings.ts with a SQL query inside a `.map()`, which
 * is both untestable and one query per reading.
 *
 * FOUR DEFECTS IN THE ORIGINAL are pinned here, all the same shape — a truthy
 * check on a number where 0 is a legitimate value:
 *
 *     liters_used:    litersUsed    ? round(litersUsed)    : null
 *     liters_per_day: litersPerDay  ? round(litersPerDay)  : null
 *     hdd_period:     hddPeriod     ? round(hddPeriod)     : null
 *     liters_per_hdd: litersPerHdd  ? round(litersPerHdd)  : null
 *
 * Each turns a real measured zero into "no data". Zero litres used over a mild
 * week is a FACT about the house; reporting it as unknown loses it.
 */

function readings(...entries: [string, number][]): ReadingForEnrichment[] {
  return entries.map(([date, gaugePercent], index) => ({
    id: index + 1,
    clientUuid: null,
    date,
    gaugePercent,
    notes: null,
    createdAt: `${date}T12:00:00.000Z`,
  }));
}

/** Readings arrive date DESC, as the repository returns them. */
const twoWeeks = readings(['2025-12-29', 80], ['2025-12-15', 90]);

describe('enrichReadings', () => {
  it('estimates litres in the tank from the gauge percentage', () => {
    const [latest] = enrichReadings(readings(['2025-12-29', 50]), () => null);

    expect(latest.estLiters).toBe(500);
  });

  it('leaves the oldest reading without a comparison, having nothing to compare to', () => {
    const [, oldest] = enrichReadings(twoWeeks, () => null);

    expect(oldest.daysSinceLast).toBeNull();
    expect(oldest.litersUsed).toBeNull();
  });

  it('counts the days between consecutive readings', () => {
    const [latest] = enrichReadings(twoWeeks, () => null);

    expect(latest.daysSinceLast).toBe(14);
  });

  it('computes litres used and litres per day', () => {
    const [latest] = enrichReadings(twoWeeks, () => null);

    expect(latest.litersUsed).toBe(100);
    expect(latest.litersPerDay).toBe(7.14);
  });

  /**
   * A gauge that went UP means a fill happened in between, so the difference is
   * not consumption. Reported as null rather than as negative use — a negative
   * litres-used would flow straight into the efficiency figure.
   */
  it('reports null consumption when the gauge rose, because a fill happened', () => {
    const afterFill = readings(['2025-12-29', 95], ['2025-12-15', 20]);

    const [latest] = enrichReadings(afterFill, () => null);

    expect(latest.litersUsed).toBeNull();
    expect(latest.litersPerDay).toBeNull();
    expect(latest.litersPerHdd).toBeNull();
  });

  describe('L/HDD efficiency', () => {
    it('divides litres used by the heating degree days for the period', () => {
      const [latest] = enrichReadings(twoWeeks, () => 523.6);

      expect(latest.hddPeriod).toBe(523.6);
      expect(latest.litersPerHdd).toBe(0.191);
    });

    /**
     * No weather recorded for the period is NOT zero HDD. The original
     * conflated them, because `if (hddResult?.total_hdd)` is false for both.
     * Only one of them permits an efficiency figure, and inventing one from a
     * missing period is how a comparison concludes the windows made things
     * worse.
     */
    it('reports no efficiency when the period has no weather data', () => {
      const [latest] = enrichReadings(twoWeeks, () => null);

      expect(latest.hddPeriod).toBeNull();
      expect(latest.litersPerHdd).toBeNull();
    });

    /**
     * Zero HDD is a real measurement — a mild period with no heating demand.
     * The HDD total must be reported as 0, and the efficiency left null,
     * because litres per zero degree-days is undefined, not infinite.
     */
    it('keeps a measured zero HDD as 0 while leaving efficiency undefined', () => {
      const [latest] = enrichReadings(twoWeeks, () => 0);

      expect(latest.hddPeriod).toBe(0);
      expect(latest.litersPerHdd).toBeNull();
    });
  });

  describe('zero is a value, not absence — the four original defects', () => {
    /** Same gauge on both dates: nothing burned. A fact, not a gap. */
    const noConsumption = readings(['2025-07-29', 80], ['2025-07-15', 80]);

    it('reports 0 litres used rather than null', () => {
      const [latest] = enrichReadings(noConsumption, () => 0);

      expect(latest.litersUsed).toBe(0);
    });

    it('reports 0 litres per day rather than null', () => {
      const [latest] = enrichReadings(noConsumption, () => 0);

      expect(latest.litersPerDay).toBe(0);
    });

    it('reports 0 litres per HDD rather than null when there were degree days', () => {
      const [latest] = enrichReadings(noConsumption, () => 40);

      expect(latest.hddPeriod).toBe(40);
      expect(latest.litersPerHdd).toBe(0);
    });
  });

  /**
   * Two readings on the same day cannot produce a per-day rate. Division by
   * zero days would yield Infinity, which serialises to null in JSON and so
   * would look like missing data rather than a nonsensical input.
   */
  it('reports no daily rate for two readings on the same date', () => {
    const sameDay = readings(['2025-12-29', 80], ['2025-12-29', 90]);

    const [latest] = enrichReadings(sameDay, () => 10);

    expect(latest.daysSinceLast).toBe(0);
    expect(latest.litersPerDay).toBeNull();
  });

  it('asks for HDD over the period after the previous reading up to this one', () => {
    const asked: [string, string][] = [];

    enrichReadings(twoWeeks, (from, to) => {
      asked.push([from, to]);
      return 100;
    });

    // Exclusive of the previous reading's day, inclusive of this one.
    expect(asked).toEqual([['2025-12-15', '2025-12-29']]);
  });

  it('returns an empty list for no readings', () => {
    expect(enrichReadings([], () => null)).toEqual([]);
  });
});
