import { parseStringPromise } from 'xml2js';
import { calculateMeanTemp, calculateHDD } from './calculations.js';

/**
 * Parses one Environment Canada "yesterday" XML file for a Fort Smith
 * observation.
 *
 * Pure apart from XML parsing: no HTTP, no database. Extracted from
 * `weatherFetcher.ts`, where it was interleaved with a fetch loop and a
 * synchronous SQLite insert and therefore untestable.
 *
 * IT RETURNS THE STATION, and that is the substantive change. The original
 * accepted ZSM or YSM or any station named "fort smith" and then wrote every
 * row with `source: 'auto'`, discarding the station at the moment it was known.
 * ZSM (Fort Smith Climate) and YSM (the airport) are different instruments, and
 * an unrecorded mix biases any before/after comparison built on the series —
 * which is the whole purpose of this data. The caller is now obliged to keep
 * the provenance.
 */

/** Preference order. Explicit so the answer does not depend on file order. */
const STATION_PREFERENCE = ['ZSM', 'YSM'] as const;

export interface WeatherObservation {
  date: string;
  /** The station the reading actually came from. Never discarded. */
  station: string;
  maxTemp: number;
  minTemp: number;
  meanTemp: number;
  hdd: number;
}

interface XmlElement {
  $?: { name?: string; value?: string };
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function attributeMap(elements: XmlElement[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const element of elements) {
    const { name, value } = element.$ ?? {};
    if (name !== undefined && value !== undefined) map.set(name, value);
  }

  return map;
}

/**
 * Guarded on PARSEABILITY, not truthiness. The original used
 * `if (name === '...' && value)`, so a value of "0" — 0 °C, an ordinary spring
 * day here — was read as absent. A missing value and a value of zero are
 * different facts.
 */
function parseTemperature(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;

  const value = Number(raw);

  return Number.isFinite(value) ? value : null;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function isFortSmith(station: string, stationName: string): boolean {
  return (
    STATION_PREFERENCE.includes(station as (typeof STATION_PREFERENCE)[number]) ||
    stationName.toLowerCase().includes('fort smith')
  );
}

export async function parseWeatherObservation(
  xmlText: string,
  dataDate: string,
): Promise<WeatherObservation | null> {
  let parsed: unknown;

  try {
    parsed = await parseStringPromise(xmlText, {
      explicitArray: false,
      ignoreAttrs: false,
      // Strip namespace prefixes (om:member -> member).
      tagNameProcessors: [(name: string) => name.replace(/^.*:/, '')],
    });
  } catch {
    // A malformed file skips its day and is reported by the caller. One bad
    // file must not abort a whole range fetch.
    return null;
  }

  const collection = (parsed as { ObservationCollection?: { member?: unknown } })
    ?.ObservationCollection;

  if (!collection) return null;

  const candidates: WeatherObservation[] = [];

  for (const member of asArray(collection.member as Record<string, unknown>)) {
    const observation = (member as { Observation?: Record<string, unknown> })
      ?.Observation;

    if (!observation) continue;

    const metadata = (observation.metadata as { set?: Record<string, unknown> })?.set;
    const identification = (
      metadata?.['identification-elements'] as { element?: XmlElement | XmlElement[] }
    )?.element;

    const ids = attributeMap(asArray(identification));
    const station = ids.get('transport_canada_id') ?? '';
    const stationName = ids.get('station_name') ?? '';

    if (!isFortSmith(station, stationName)) continue;

    const resultElements = (
      (observation.result as { elements?: { element?: XmlElement | XmlElement[] } })
        ?.elements
    )?.element;

    const results = attributeMap(asArray(resultElements));

    const maxTemp = parseTemperature(results.get('air_temperature_yesterday_high'));
    const minTemp = parseTemperature(results.get('air_temperature_yesterday_low'));

    // A reading present but unparseable is not a reading.
    if (maxTemp === null || minTemp === null) continue;

    const meanTemp = calculateMeanTemp(minTemp, maxTemp);

    candidates.push({
      date: dataDate,
      station: station || stationName,
      maxTemp,
      minTemp,
      meanTemp: round(meanTemp, 2),
      hdd: round(calculateHDD(meanTemp), 2),
    });
  }

  if (candidates.length === 0) return null;

  // Prefer the climate station over the airport when a file carries both.
  for (const preferred of STATION_PREFERENCE) {
    const match = candidates.find((candidate) => candidate.station === preferred);
    if (match) return match;
  }

  return candidates[0];
}
