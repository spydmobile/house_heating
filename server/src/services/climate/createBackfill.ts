import type { FetchDaysResult } from './createClimateArchive.js';

/**
 * Fills a date range from the climate archive, recording which station every
 * day came from.
 *
 * Three rules, and each one decides whether the window-replacement ROI can be
 * trusted:
 *
 *   ZSM FIRST, YSM ONLY FOR WHAT ZSM LACKS. They are different instruments at
 *   different coordinates — ZSM is FORT SMITH CLIMATE, YSM the airport. Mixing
 *   them where no mixing is needed adds instrument bias to a comparison that is
 *   measuring an 8.8% difference between quarters.
 *
 *   A DAY NEITHER STATION HAS IS RECORDED MISSING AND NEVER INTERPOLATED.
 *   2025-01-03 is such a day, in the BASELINE quarter. An invented value there
 *   biases the very number the project exists to produce.
 *
 *   NOTHING IS WRITTEN WITHOUT PROVENANCE. Storing a day without its station is
 *   precisely the defect the old fetcher had: it accepted ZSM or YSM and wrote
 *   'auto' for both, discarding the station at the moment it was known.
 */

export interface BackfillArchive {
  fetchDays(station: string, from: string, to: string): Promise<FetchDaysResult>;
}

export interface BackfillDay {
  date: string;
  station: string;
  maxTemp: number | null;
  minTemp: number | null;
  meanTemp: number | null;
  hdd: number | null;
  source: string;
}

export interface BackfillStore {
  /**
   * Writes the day ONLY if the store has no row for that date, and returns
   * whether it wrote. Postgres expresses this as ON CONFLICT (date) DO NOTHING,
   * which returns no row when it skips — the signal this boolean carries.
   *
   * It used to be `save`, writing through an upsert, so a backfill over a
   * partly covered range replaced what was already there and reported it as
   * though it had filled a gap. Inserting and overwriting are different
   * actions; the caller is entitled to know which happened.
   */
  saveIfAbsent(day: BackfillDay): Promise<boolean>;
}

export interface BackfillDependencies {
  archive: BackfillArchive;
  weather: BackfillStore;
}

export interface BackfillReport {
  from: string;
  to: string;
  /** Days the range contains — the denominator for any coverage judgement. */
  expectedDays: number;
  /** Days actually INSERTED. Never includes a day that was already present. */
  written: number;
  /**
   * Dates the store already held, left exactly as they were. Separate from
   * `written` because filling a gap and replacing a row are different acts, and
   * separate from `missing` because a skipped day is PRESENT.
   */
  skipped: string[];
  /** Dates taken from YSM because ZSM had none. Visible, not buried. */
  fromSecondary: string[];
  /** Dates NEITHER station had. Recorded, never filled in. */
  missing: string[];
  /** Days fetched but not stored. NOT the same as missing. */
  errors: string[];
  hddDiscrepancies: { date: string; archive: number; calculated: number }[];
}

const PRIMARY = 'ZSM';
const SECONDARY = 'YSM';
const DAY_MS = 86_400_000;

function daysInRange(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);

  return (
    Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS) + 1
  );
}

export function createBackfill({ archive, weather }: BackfillDependencies) {
  async function run(from: string, to: string): Promise<BackfillReport> {
    const report: BackfillReport = {
      from,
      to,
      expectedDays: daysInRange(from, to),
      written: 0,
      skipped: [],
      fromSecondary: [],
      missing: [],
      errors: [],
      hddDiscrepancies: [],
    };

    // An archive failure PROPAGATES. A short fill is indistinguishable
    // downstream from a quarter that genuinely had little weather.
    const primary = await archive.fetchDays(PRIMARY, from, to);

    report.hddDiscrepancies.push(...primary.hddDiscrepancies);

    const toWrite = [...primary.days];

    // The secondary station is consulted ONLY for what the primary lacked, and only
    // day by day — never as a second sweep of the whole range.
    if (primary.missing.length > 0) {
      for (const date of primary.missing) {
        const secondary = await archive.fetchDays(SECONDARY, date, date);

        report.hddDiscrepancies.push(...secondary.hddDiscrepancies);

        const covered = secondary.days.find((d) => d.date === date);

        if (covered) {
          toWrite.push(covered);
          report.fromSecondary.push(date);
        } else {
          // Neither station has it. Recorded and left alone.
          report.missing.push(date);
        }
      }
    }

    toWrite.sort((a, b) => a.date.localeCompare(b.date));

    for (const day of toWrite) {
      try {
        // INSERT IF ABSENT. This wrote through an upsert until 2026-10-26,
        // which meant a backfill over a partly covered range REPLACED the rows
        // already there — 30 of 90 days for Q1 2026 — while reporting
        // "written: 90" and naming no overwrite at all.
        //
        // Franco's ruling: fill gaps, never rewrite what is present. Improving
        // the legacy rows may well be worth doing — they carry `auto` with the
        // station discarded — but that is a decision about the record, not a
        // side effect of filling gaps.
        const inserted = await weather.saveIfAbsent({
          date: day.date,
          station: day.station,
          maxTemp: day.maxTemp,
          minTemp: day.minTemp,
          meanTemp: day.meanTemp,
          hdd: day.hdd,
          // `source` says HOW it arrived; `station` says WHICH instrument.
          // They are different facts and both are kept.
          source: `climate-archive:${day.station}`,
        });

        if (!inserted) {
          // PRESENT, not missing. Reporting a skipped day as missing would
          // send someone looking for weather that is already there.
          report.skipped.push(day.date);
          continue;
        }

        report.written += 1;
      } catch (error) {
        // NOT a missing day. A failing database must never look like weather
        // that was never recorded — one of those is fixable.
        report.errors.push(
          `${day.date}: fetched but not stored — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return report;
  }

  return { run };
}
