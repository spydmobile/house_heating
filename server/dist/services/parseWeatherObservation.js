"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseWeatherObservation = parseWeatherObservation;
const xml2js_1 = require("xml2js");
const calculations_js_1 = require("./calculations.js");
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
const STATION_PREFERENCE = ['ZSM', 'YSM'];
function asArray(value) {
    if (value === undefined)
        return [];
    return Array.isArray(value) ? value : [value];
}
function attributeMap(elements) {
    const map = new Map();
    for (const element of elements) {
        const { name, value } = element.$ ?? {};
        if (name !== undefined && value !== undefined)
            map.set(name, value);
    }
    return map;
}
/**
 * Guarded on PARSEABILITY, not truthiness. The original used
 * `if (name === '...' && value)`, so a value of "0" — 0 °C, an ordinary spring
 * day here — was read as absent. A missing value and a value of zero are
 * different facts.
 */
function parseTemperature(raw) {
    if (raw === undefined || raw.trim() === '')
        return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}
function round(value, places) {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
}
function isFortSmith(station, stationName) {
    return (STATION_PREFERENCE.includes(station) ||
        stationName.toLowerCase().includes('fort smith'));
}
async function parseWeatherObservation(xmlText, dataDate) {
    let parsed;
    try {
        parsed = await (0, xml2js_1.parseStringPromise)(xmlText, {
            explicitArray: false,
            ignoreAttrs: false,
            // Strip namespace prefixes (om:member -> member).
            tagNameProcessors: [(name) => name.replace(/^.*:/, '')],
        });
    }
    catch {
        // A malformed file skips its day and is reported by the caller. One bad
        // file must not abort a whole range fetch.
        return null;
    }
    const collection = parsed
        ?.ObservationCollection;
    if (!collection)
        return null;
    const candidates = [];
    for (const member of asArray(collection.member)) {
        const observation = member
            ?.Observation;
        if (!observation)
            continue;
        const metadata = observation.metadata?.set;
        const identification = metadata?.['identification-elements']?.element;
        const ids = attributeMap(asArray(identification));
        const station = ids.get('transport_canada_id') ?? '';
        const stationName = ids.get('station_name') ?? '';
        if (!isFortSmith(station, stationName))
            continue;
        const resultElements = (observation.result
            ?.elements)?.element;
        const results = attributeMap(asArray(resultElements));
        const maxTemp = parseTemperature(results.get('air_temperature_yesterday_high'));
        const minTemp = parseTemperature(results.get('air_temperature_yesterday_low'));
        // A reading present but unparseable is not a reading.
        if (maxTemp === null || minTemp === null)
            continue;
        const meanTemp = (0, calculations_js_1.calculateMeanTemp)(minTemp, maxTemp);
        candidates.push({
            date: dataDate,
            station: station || stationName,
            maxTemp,
            minTemp,
            meanTemp: round(meanTemp, 2),
            hdd: round((0, calculations_js_1.calculateHDD)(meanTemp), 2),
        });
    }
    if (candidates.length === 0)
        return null;
    // Prefer the climate station over the airport when a file carries both.
    for (const preferred of STATION_PREFERENCE) {
        const match = candidates.find((candidate) => candidate.station === preferred);
        if (match)
            return match;
    }
    return candidates[0];
}
