"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichReadings = enrichReadings;
const calculations_js_1 = require("./calculations.js");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/**
 * Whole days between two YYYY-MM-DD dates, computed in UTC.
 *
 * Fort Smith observes DST, so parsing a date-only string in local time gives
 * 23- and 25-hour days twice a year, and a rounded difference across such a
 * boundary can land a day out.
 */
function daysBetween(fromDate, toDate) {
    const [fy, fm, fd] = fromDate.split('-').map(Number);
    const [ty, tm, td] = toDate.split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY);
}
function round(value, places) {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
}
/** Readings must arrive date DESC, as the repository returns them. */
function enrichReadings(readings, hddForPeriod) {
    return readings.map((reading, index) => {
        const estLiters = (0, calculations_js_1.estimateLiters)(reading.gaugePercent);
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
        const rawLitersUsed = (0, calculations_js_1.estimateLiters)(previous.gaugePercent) - estLiters;
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
        const litersPerDay = daysSinceLast > 0
            ? round((0, calculations_js_1.calculateDailyConsumption)(rawLitersUsed, daysSinceLast), 2)
            : null;
        const hdd = hddForPeriod(previous.date, reading.date);
        // null means no weather recorded; 0 means a measured mild period. Only the
        // second is a number, and neither permits dividing by zero degree days —
        // litres per 0 HDD is undefined, not infinite and not zero.
        const hddPeriod = hdd === null ? null : round(hdd, 1);
        const litersPerHdd = hdd !== null && hdd > 0 ? round(rawLitersUsed / hdd, 3) : null;
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
