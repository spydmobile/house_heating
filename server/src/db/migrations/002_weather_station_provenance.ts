import type { Migration } from './runMigrations';

/**
 * Records WHICH station each weather day came from.
 *
 * The backfill's whole design rests on this. ZSM (Fort Smith Climate) is the
 * series; four named days come from YSM (the airport) because ZSM has no record
 * for them — verified against the live archive, where ZSM returns null for all
 * four. They are different instruments at different coordinates, and an
 * unrecorded mix biases the degree-day comparison the window-replacement ROI
 * is computed from.
 *
 * `source` already carries a hint (`auto:ZSM`), but it is a free-text field
 * describing HOW a row arrived, not WHICH instrument produced it. Querying
 * provenance by parsing a prefix out of it would be a convention nothing
 * enforces.
 *
 * NULLABLE on purpose. The 109 rows imported from SQLite genuinely do not know
 * their station — the old fetcher accepted ZSM or YSM and wrote 'auto' for
 * both, discarding it at the moment it was known. Backfilling a guess into
 * those rows would manufacture provenance that was never recorded. Null means
 * "not known", and that is the truth about them.
 *
 * THIS IS ALSO THE FIRST REAL EXERCISE OF THE MIGRATION MECHANISM — the change
 * `CREATE TABLE IF NOT EXISTS` could not express, which is why that idiom was
 * replaced rather than carried as debt.
 */
export const weatherStationProvenance: Migration = {
  version: 2,
  name: 'weather_station_provenance',
  sql: `
    ALTER TABLE weather_data
      ADD COLUMN station TEXT;

    COMMENT ON COLUMN weather_data.station IS
      'Environment Canada station code the reading came from (ZSM | YSM). '
      'NULL means the provenance was never recorded — true of every row '
      'imported from the legacy SQLite database, and not to be guessed at.';

    -- Provenance is queried as "which days came from the fallback station",
    -- so the index is on the column rather than on (date, station).
    CREATE INDEX idx_weather_data_station ON weather_data (station);
  `,
};
