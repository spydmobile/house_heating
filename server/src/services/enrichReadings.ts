import { estimateLiters, calculateDailyConsumption } from './calculations.js';

/**
 * Derives consumption and L/HDD efficiency from consecutive gauge readings.
 *
 * PURE. The HDD for each period is supplied by the caller through `hddForPeriod`
 * rather than queried in here, which is what makes every edge case testable and
 * also removes the original's query-per-reading inside a `.map()`.
 *
 * The rule throughout: a measured zero is a VALUE and absence is null, and the
 * two are never conflated. The original used truthy checks on four numbers, so
 * a genuine zero — nothing burned over a mild week — was reported as no data.
 */

export interface ReadingForEnrichment {
  id: number;
  clientUuid: string | null;
  date: string;
  gaugePercent: number;
  notes: string | null;
  createdAt: string;
}

export interface EnrichedReading extends ReadingForEnrichment {
  estLiters: number;
  daysSinceLast: number | null;
  litersUsed: number | null;
  litersPerDay: number | null;
  hddPeriod: number | null;
  /** Litres per heating degree day. The metric the window ROI is asked in. */
  litersPerHdd: number | null;
}

/**
 * Total HDD for a period, exclusive of `from`'s day and inclusive of `to`'s.
 * Returns null when the period has NO weather data — which is not zero HDD.
 */
export type HddForPeriod = (from: string, to: string) => number | null;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days between two YYYY-MM-DD dates, computed in UTC.
 *
 * Fort Smith observes DST, so parsing a date-only string in local time gives
 * 23- and 25-hour days twice a year, and a rounded difference across such a
 * boundary can land a day out.
 */
function daysBetween(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  const [ty, tm, td] = toDate.split('-').map(Number);

  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY,
  );
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Readings must arrive date DESC, as the repository returns them. */
export function enrichReadings(
  readings: ReadingForEnrichment[],
  hddForPeriod: HddForPeriod,
): EnrichedReading[] {
  return readings.map((reading, index) => {
    const estLiters = estimateLiters(reading.gaugePercent);

    const previous = readings[index + 1];

    // The oldest reading has nothing before it to compare against.
    if (!previous) {
      return {
        ...reading,
        estLiters,
        daysSinceLast: null,
        litersUsed: null,
        litersPerDay: null,
        hddPeriod: null,
        litersPerHdd: null,
      };
    }

    const daysSinceLast = daysBetween(previous.date, reading.date);
    const rawLitersUsed = estimateLiters(previous.gaugePercent) - estLiters;

    // A gauge that ROSE means a fill happened in the period, so the difference
    // is not consumption. Null rather than a negative, which would otherwise
    // flow straight into the efficiency figure.
    if (rawLitersUsed < 0) {
      return {
        ...reading,
        estLiters,
        daysSinceLast,
        litersUsed: null,
        litersPerDay: null,
        hddPeriod: null,
        litersPerHdd: null,
      };
    }

    const litersUsed = round(rawLitersUsed, 1);

    // Two readings on the same day cannot produce a rate. Dividing by zero days
    // yields Infinity, which JSON serialises to null — indistinguishable from
    // missing data.
    const litersPerDay =
      daysSinceLast > 0
        ? round(calculateDailyConsumption(rawLitersUsed, daysSinceLast), 2)
        : null;

    const hdd = hddForPeriod(previous.date, reading.date);

    // null means no weather recorded; 0 means a measured mild period. Only the
    // second is a number, and neither permits dividing by zero degree days —
    // litres per 0 HDD is undefined, not infinite and not zero.
    const hddPeriod = hdd === null ? null : round(hdd, 1);
    const litersPerHdd =
      hdd !== null && hdd > 0 ? round(rawLitersUsed / hdd, 3) : null;

    return {
      ...reading,
      estLiters,
      daysSinceLast,
      litersUsed,
      litersPerDay,
      hddPeriod,
      litersPerHdd,
    };
  });
}
