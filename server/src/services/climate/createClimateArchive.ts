import { resolveStation } from './resolveStation.js';
import { calculateHDD } from '../calculations.js';

/**
 * Reads daily records from the Environment Canada climate archive.
 *
 * This is what the old `weatherFetcher` could not be: that one hit a ROLLING
 * "yesterday" file, so it could only reach back a few days however wide a range
 * it was handed — a signature that read like a backfill and was not one. The
 * archive is a real historical series (ZSM: 2003-08-01 to present), which is
 * what makes filling Q1 2025 possible.
 *
 * Verified against the live API on 2026-10-23, and both findings shaped this:
 *
 *   A DAY WITH NO MEASUREMENT STILL RETURNS A ROW. 2025-01-03 at ZSM comes back
 *   as one feature with MEAN_TEMPERATURE null. The presence of a feature is NOT
 *   the presence of data, and a fetcher that conflated them would insert a
 *   null-temperature day that reads as a reading.
 *
 *   THE ARCHIVE PUBLISHES ITS OWN HEATING_DEGREE_DAYS at base 18. That is the
 *   first known-positive control this project has had for `calculateHDD`, so
 *   the two are compared and any disagreement is REPORTED rather than resolved
 *   by quietly preferring one.
 */

export type ArchiveHttpGet = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface ArchiveDependencies {
  fetch: ArchiveHttpGet;
  baseUrl: string;
  /** The archive caps a page; a quarter is ~90 days. */
  pageSize?: number;
}

export interface ArchiveDay {
  date: string;
  /** Which instrument produced it. Never discarded. */
  station: string;
  maxTemp: number | null;
  minTemp: number | null;
  meanTemp: number;
  hdd: number;
}

export interface HddDiscrepancy {
  date: string;
  archive: number;
  calculated: number;
}

export interface FetchDaysResult {
  days: ArchiveDay[];
  /** Dates the archive holds with no measurement. Recorded, never filled in. */
  missing: string[];
  hddDiscrepancies: HddDiscrepancy[];
  warnings: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Tolerance for comparing the archive's HDD with ours — both are 1 d.p. */
const HDD_TOLERANCE = 0.11;

const DEFAULT_PAGE_SIZE = 500;

function requireDate(value: string, label: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new Error(`${label} must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(value)}`);
  }

  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));

  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) {
    throw new Error(`${label} is not a real calendar date: ${value}`);
  }

  return value;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

interface ArchiveProperties {
  LOCAL_DATE?: string;
  MEAN_TEMPERATURE?: number | null;
  MAX_TEMPERATURE?: number | null;
  MIN_TEMPERATURE?: number | null;
  HEATING_DEGREE_DAYS?: number | null;
}

export function createClimateArchive({
  fetch,
  baseUrl,
  pageSize = DEFAULT_PAGE_SIZE,
}: ArchiveDependencies) {
  async function fetchDays(
    stationCode: string,
    from: string,
    to: string,
  ): Promise<FetchDaysResult> {
    // Resolved FIRST, before any request: an unknown code must fail without
    // having asked the archive for anything.
    const station = resolveStation(stationCode);

    requireDate(from, 'from');
    requireDate(to, 'to');

    if (from > to) {
      throw new Error(
        `Inverted range: from ${from} is after to ${to}. Refusing rather than ` +
          'returning an empty series that would read as "no weather".',
      );
    }

    const days: ArchiveDay[] = [];
    const missing: string[] = [];
    const hddDiscrepancies: HddDiscrepancy[] = [];
    const warnings: string[] = [];

    let offset = 0;
    let matched = Infinity;

    // Paging is not optional. A quarter exceeds a page, and stopping at the
    // first one returns a SHORT SERIES — which is exactly how a degree-day
    // total comes out too low and makes a before/after comparison lie.
    while (offset < matched) {
      const url =
        `${baseUrl}/collections/climate-daily/items` +
        `?f=json&limit=${pageSize}&offset=${offset}` +
        `&STN_ID=${station.stnId}` +
        `&datetime=${encodeURIComponent(`${from} 00:00:00/${to} 00:00:00`)}` +
        `&sortby=LOCAL_DATE`;

      const response = await fetch(url);

      if (!response.ok) {
        // Throws rather than returning what it has. A partial series is
        // indistinguishable from a sparse one downstream.
        throw new Error(
          `Climate archive returned ${response.status} for ${station.code} ` +
            `${from}..${to}. Refusing to return a partial series.`,
        );
      }

      const body = (await response.json()) as {
        features?: { properties?: ArchiveProperties }[];
        numberMatched?: number;
      };

      const features = body.features ?? [];
      matched = body.numberMatched ?? features.length;

      for (const featureRow of features) {
        const p = featureRow.properties ?? {};
        const date = (p.LOCAL_DATE ?? '').slice(0, 10);

        if (!ISO_DATE.test(date)) continue;

        // A row with no measurement is a day the station reported nothing.
        // Recorded as missing and NEVER interpolated from its neighbours.
        if (p.MEAN_TEMPERATURE === null || p.MEAN_TEMPERATURE === undefined) {
          missing.push(date);
          continue;
        }

        const meanTemp = p.MEAN_TEMPERATURE;
        const calculated = round(calculateHDD(meanTemp), 1);
        const archiveHdd = p.HEATING_DEGREE_DAYS;

        if (
          archiveHdd !== null &&
          archiveHdd !== undefined &&
          Math.abs(archiveHdd - calculated) > HDD_TOLERANCE
        ) {
          // Reported, not resolved. If these disagree, one of them is wrong
          // about the metric this whole project is denominated in.
          hddDiscrepancies.push({ date, archive: archiveHdd, calculated });
        }

        days.push({
          date,
          station: station.code,
          maxTemp: p.MAX_TEMPERATURE ?? null,
          minTemp: p.MIN_TEMPERATURE ?? null,
          meanTemp,
          // The archive's own figure is preferred where present — it is the
          // authority for its own series — falling back to ours only when it
          // published none.
          hdd: archiveHdd ?? calculated,
        });
      }

      if (features.length === 0) break;

      offset += features.length;
    }

    if (days.length === 0) {
      // An empty range is suspicious rather than successful: downstream it
      // reads as "that quarter had no weather", which is the artifact this
      // backfill exists to remove.
      warnings.push(
        `No days returned for ${station.code} between ${from} and ${to}. ` +
          'That is not the same as the period having had no weather.',
      );
    }

    return { days, missing, hddDiscrepancies, warnings };
  }

  return { fetchDays };
}
