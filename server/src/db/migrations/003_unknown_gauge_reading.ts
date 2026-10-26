import type { Migration } from './runMigrations';

/**
 * Lets an UNKNOWN gauge reading be recorded as unknown.
 *
 * The real 2026-02-24 fill reads `gauge_percent_before = 0` with the note
 * "Gauge before fill unknown." Nobody measured an empty tank. The column was
 * NOT NULL, so the only way to file a real delivery was to type a number — and
 * `0` is not a missing value, it is the claim that the tank was empty, which
 * would be the most alarming reading in the series if it were true.
 *
 * So the schema MANUFACTURED a false measurement and the explanation went into
 * free text that no query will ever consult. That is the silent-default rule
 * broken at the only layer that could have refused it.
 *
 * Worth being exact about what this does NOT fix: the fabricated 0 never
 * reached the efficiency metric. Periods are built from gauge_readings, and
 * `disqualify()` already excludes any period containing a fill, so L/HDD was
 * never wrong. This is about the record telling the truth, not about a
 * miscomputation — and the reason to do it now is that the next unknown gauge
 * would produce another fake zero.
 *
 * `liters_before_fill` is ALREADY nullable, and it is the companion: it is
 * derived from the gauge reading, so when the gauge is unknown the litres
 * before the fill are unknown too. Estimating them from 0 would restate the
 * same fabrication one column over.
 *
 * NOT repaired here. Migrations must not rewrite history: the 2026-02-24 row
 * keeps its 0 until someone decides what that row should say, and this
 * migration only makes the honest value expressible.
 */
export const unknownGaugeReading: Migration = {
  version: 3,
  name: 'unknown_gauge_reading',
  sql: `
    ALTER TABLE fuel_fills
      ALTER COLUMN gauge_percent_before DROP NOT NULL;

    COMMENT ON COLUMN fuel_fills.gauge_percent_before IS
      'Tank gauge percentage read BEFORE the delivery. NULL means it was not '
      'read — which happens, and must not be recorded as 0: that would assert '
      'an empty tank. A genuine 0 remains a valid reading.';

    COMMENT ON COLUMN fuel_fills.liters_before_fill IS
      'Litres in the tank before the delivery, derived from '
      'gauge_percent_before. NULL whenever the gauge reading is NULL — an '
      'unknown gauge cannot yield a known volume.';
  `,
};
