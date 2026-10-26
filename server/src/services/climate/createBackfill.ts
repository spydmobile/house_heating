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
  save(day: BackfillDay): Promise<unknown>;
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
  written: number;
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
        await weather.save({
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
