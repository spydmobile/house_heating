import { describe, it, expect } from 'vitest';
import { measureEfficiency, type EfficiencyPeriod } from './measureEfficiency';

/**
 * Measured L/HDD from complete consumption periods — replacing the hardcoded
 * `const efficiency = 0.4` that drove refill predictions.
 *
 * WHY THIS IS ALLOWED TO REFUSE. L/HDD is litres divided by degree days, and
 * the weather series has holes — January 2026 has six days of thirty-one. The
 * litres consumed over such a period are real; the HDD computed from six days
 * is a fraction of the truth. Divide one by the other and the efficiency comes
 * out INFLATED, and that number then drives a refill prediction. A confidently
 * wrong answer from an instrument that cannot see is the failure this project
 * is most prone to.
 *
 * So a period counts only if it is complete in both senses: no fill inside it
 * (a fill breaks the consumption arithmetic) and weather for every day of it.
 * When nothing qualifies the answer is null WITH A REASON, never a fallback
 * constant. Franco's ruling, 2026-10-20: refuse to predict and say why.
 */

function period(overrides: Partial<EfficiencyPeriod> = {}): EfficiencyPeriod {
  return {
    from: '2025-12-15',
    to: '2025-12-29',
    days: 14,
    litersUsed: 100,
    hdd: 523.6,
    weatherDays: 14,
    hadFill: false,
    ...overrides,
  };
}

describe('measureEfficiency', () => {
  it('divides total litres by total degree days across qualifying periods', () => {
    const result = measureEfficiency([period()]);

    expect(result.litersPerHdd).toBeCloseTo(0.191, 3);
  });

  /**
   * Aggregated as a RATIO OF SUMS, not a mean of ratios. Summing first weights
   * each period by its degree days, so a cold fortnight counts for more than a
   * mild one — averaging the ratios would give a quiet week equal say.
   */
  it('weights periods by degree days rather than averaging their ratios', () => {
    const cold = period({ litersUsed: 300, hdd: 1000, weatherDays: 20, days: 20 });
    const mild = period({ litersUsed: 10, hdd: 20, weatherDays: 5, days: 5 });

    const result = measureEfficiency([cold, mild]);

    // Ratio of sums: 310 / 1020 = 0.3039. Mean of ratios would be 0.4,
    // which is the number this whole exercise exists to stop using.
    expect(result.litersPerHdd).toBeCloseTo(0.304, 3);
    expect(result.litersPerHdd).not.toBeCloseTo(0.4, 2);
  });

  describe('what it refuses, and why it says so', () => {
    it('refuses when a period has incomplete weather, naming coverage as the reason', () => {
      const sparse = period({ days: 31, weatherDays: 6 });

      const result = measureEfficiency([sparse]);

      expect(result.litersPerHdd).toBeNull();
      expect(result.reason).toMatch(/weather/i);
      expect(result.qualifyingPeriods).toBe(0);
    });

    it('excludes a period containing a fill, because the arithmetic breaks', () => {
      const result = measureEfficiency([period({ hadFill: true })]);

      expect(result.litersPerHdd).toBeNull();
      expect(result.reason).toMatch(/fill/i);
    });

    it('refuses on no periods at all', () => {
      const result = measureEfficiency([]);

      expect(result.litersPerHdd).toBeNull();
      expect(result.reason).toMatch(/no .*period/i);
    });

    /**
     * Zero degree days is a real mild period, and litres per zero degree days
     * is undefined rather than infinite. It must not become a division.
     */
    it('excludes a period with zero degree days rather than dividing by it', () => {
      const result = measureEfficiency([period({ hdd: 0, litersUsed: 0 })]);

      expect(result.litersPerHdd).toBeNull();
      expect(result.reason).toMatch(/degree day/i);
    });

    it('excludes a period whose consumption is unknown', () => {
      const result = measureEfficiency([period({ litersUsed: null })]);

      expect(result.litersPerHdd).toBeNull();
    });

    /**
     * NEVER 0.4, and never any other constant. The reason this test exists is
     * that the fallback it guards against is what the code did for a year.
     */
    it('never falls back to a constant when it refuses', () => {
      const result = measureEfficiency([period({ days: 31, weatherDays: 6 })]);

      expect(result.litersPerHdd).toBeNull();
      expect(result.litersPerHdd).not.toBe(0.4);
    });
  });

  describe('what it reports alongside the number', () => {
    /**
     * A bare ratio is what produced a hardcoded 0.4 nobody questioned. The
     * evidence travels with it so a caller can judge whether to trust it.
     */
    it('reports the litres, degree days, days and period count behind the figure', () => {
      const result = measureEfficiency([
        period({ litersUsed: 100, hdd: 500, days: 14, weatherDays: 14 }),
        period({ litersUsed: 200, hdd: 800, days: 20, weatherDays: 20 }),
      ]);

      expect(result.qualifyingPeriods).toBe(2);
      expect(result.totalLiters).toBe(300);
      expect(result.totalHdd).toBe(1300);
      expect(result.totalDays).toBe(34);
    });

    it('reports how many periods were excluded and why', () => {
      const result = measureEfficiency([
        period(),
        period({ hadFill: true }),
        period({ days: 31, weatherDays: 6 }),
      ]);

      expect(result.qualifyingPeriods).toBe(1);
      expect(result.excluded).toHaveLength(2);
      expect(result.excluded.map((e) => e.reason).join(' ')).toMatch(/fill/i);
      expect(result.excluded.map((e) => e.reason).join(' ')).toMatch(/weather/i);
    });

    it('names the date range the figure is drawn from', () => {
      const result = measureEfficiency([
        period({ from: '2025-11-01', to: '2025-11-15' }),
        period({ from: '2025-12-15', to: '2025-12-29' }),
      ]);

      expect(result.from).toBe('2025-11-01');
      expect(result.to).toBe('2025-12-29');
    });

    it('carries no reason when it did produce a figure', () => {
      expect(measureEfficiency([period()]).reason).toBeNull();
    });
  });
});
