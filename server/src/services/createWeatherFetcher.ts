import { parseWeatherObservation } from './parseWeatherObservation.js';
import type { NewWeatherDay, WeatherDay } from '../repositories/PostgresWeatherRepository.js';

/**
 * Fetches a date range of observations from Environment Canada and stores them.
 *
 * HTTP and storage are both INJECTED. The original called `fetch` directly and
 * wrote through a module-level SQLite handle, so nothing here could be
 * exercised — including the date arithmetic, which is the part most likely to
 * be wrong and the part that silently produces a short series.
 *
 * Note what this endpoint is NOT: the MSC Datamart path below is a ROLLING
 * "yesterday" file, not an archive, so it can only reach back a few days
 * whatever range is asked for. The signature takes a range and that reads like
 * a backfill; it is not one. Historical daily data needs the Environment Canada
 * climate archive, which is separate work.
 */

export interface FetcherWeatherStore {
  save(day: NewWeatherDay): Promise<WeatherDay>;
}

/** The slice of `fetch` this needs. Keeps the port small and fakeable. */
export type HttpGet = (url: string) => Promise<{
  ok: boolean;
  text(): Promise<string>;
}>;

export interface WeatherFetcherDependencies {
  weather: FetcherWeatherStore;
  fetch: HttpGet;
  baseUrl: string;
}

export interface FetchRangeResult {
  fetched: number;
  /** Days with no usable observation in the source files. */
  skipped: number;
  /** One line per problem, each naming its date. */
  errors: string[];
  data: WeatherDay[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtcDate(value: string, label: string): Date {
  if (!ISO_DATE.test(value)) {
    throw new Error(`${label} must be an ISO date (YYYY-MM-DD), got "${value}"`);
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${label} is not a real calendar date: "${value}"`);
  }

  return date;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Iterated in UTC. Fort Smith observes DST, so stepping a local-time date by
 * 24 hours lands on the same day or skips one at the two boundaries each year.
 */
function eachDay(from: Date, to: Date): string[] {
  const days: string[] = [];

  for (
    let cursor = new Date(from);
    cursor.getTime() <= to.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    days.push(toIsoDate(cursor));
  }

  return days;
}

export function createWeatherFetcher({
  weather,
  fetch,
  baseUrl,
}: WeatherFetcherDependencies) {
  /**
   * The file containing a given day's observations is dated the FOLLOWING day,
   * because it is "yesterday's" file.
   */
  function urlsFor(observationDate: string): string[] {
    const next = toUtcDate(observationDate, 'date');
    next.setUTCDate(next.getUTCDate() + 1);

    const stamp = toIsoDate(next).replace(/-/g, '');

    return [
      `${baseUrl}/today/observations/xml/NT/yesterday/yesterday_nt_${stamp}_e.xml`,
      `${baseUrl}/${stamp}/WXO-DD/observations/xml/NT/yesterday/yesterday_nt_${stamp}_e.xml`,
    ];
  }

  async function fetchRange(from: string, to: string): Promise<FetchRangeResult> {
    const start = toUtcDate(from, 'from');
    const end = toUtcDate(to, 'to');

    // An inverted range is a caller mistake. The original's `while (current <=
    // end)` did nothing and reported a successful fetch of zero days, which is
    // indistinguishable from a range that genuinely had no data.
    if (start.getTime() > end.getTime()) {
      throw new Error(
        `Inverted range: from ${from} is after to ${to}. Refusing rather than ` +
          'reporting a successful fetch of zero days.',
      );
    }

    const result: FetchRangeResult = { fetched: 0, skipped: 0, errors: [], data: [] };

    for (const date of eachDay(start, end)) {
      let observation = null;

      for (const url of urlsFor(date)) {
        try {
          const response = await fetch(url);
          if (!response.ok) continue;

          observation = await parseWeatherObservation(await response.text(), date);
          if (observation) break;
        } catch {
          // Network failure on one URL: try the next, then the next day. A
          // range fetch that aborts halfway leaves a partial series with no
          // record of where it stopped.
          continue;
        }
      }

      if (!observation) {
        result.skipped += 1;
        result.errors.push(`${date}: no usable Fort Smith observation found`);
        continue;
      }

      try {
        const saved = await weather.save({
          date: observation.date,
          maxTemp: observation.maxTemp,
          minTemp: observation.minTemp,
          meanTemp: observation.meanTemp,
          hdd: observation.hdd,
          // The station travels with the reading. The original wrote 'auto'
          // for both ZSM and YSM, discarding provenance at the moment it was
          // known — and they are different instruments.
          source: `auto:${observation.station}`,
        });

        result.fetched += 1;
        result.data.push(saved);
      } catch (error) {
        // NOT a skipped day. The day was fetched and could not be stored, and
        // counting it as skipped would make a failing database look like
        // missing weather.
        result.errors.push(
          `${date}: fetched but failed to store — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return result;
  }

  return { fetchRange };
}
