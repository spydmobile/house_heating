"use strict";
/**
 * Keeps the weather series current by catching up from the last recorded day.
 *
 * Converted from `weatherSync.ts`, which read and wrote through the old SQLite
 * handle and scheduled itself at module scope. The clock is injected here,
 * because this is almost entirely date arithmetic and otherwise every test
 * would depend on the day it ran.
 *
 * A FAILED SYNC NEVER PROPAGATES. Environment Canada being unreachable is an
 * ordinary condition at a remote site, and the app is wholly usable without
 * today's weather. Taking the server down over it would turn a minor outage
 * into a major one.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWeatherSync = createWeatherSync;
const ONE_HOUR_MS = 60 * 60 * 1000;
/** Days to reach back when there is no weather at all. */
const INITIAL_BACKFILL_DAYS = 30;
function toIsoDate(date) {
    return date.toISOString().slice(0, 10);
}
/** Days are added in UTC: Fort Smith observes DST, so local stepping drifts. */
function addDays(isoDate, days) {
    const [year, month, day] = isoDate.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return toIsoDate(date);
}
function createWeatherSync({ weather, fetcher, now = () => new Date(), }) {
    let timer = null;
    async function catchUp() {
        try {
            // Environment Canada publishes "yesterday" files, so yesterday is the
            // newest day that can exist.
            const yesterday = addDays(toIsoDate(now()), -1);
            const latest = await weather.latestDate();
            const from = latest === null
                ? addDays(yesterday, -(INITIAL_BACKFILL_DAYS - 1))
                : addDays(latest, 1);
            // Covers both "already current" and "somehow ahead". An ahead date would
            // otherwise produce an inverted range, which the fetcher rejects by
            // design — correct of it, but this should not generate one.
            if (from > yesterday) {
                console.log(`[house-heating] weather is current (latest ${latest})`);
                return;
            }
            console.log(`[house-heating] syncing weather ${from} to ${yesterday}`);
            const result = await fetcher.fetchRange(from, yesterday);
            console.log(`[house-heating] weather sync: ${result.fetched} fetched, ` +
                `${result.skipped} skipped`);
            if (result.errors.length > 0) {
                // Truncated deliberately: a thirty-day gap would otherwise print thirty
                // lines at every boot and bury everything else.
                console.log(`[house-heating] weather sync issues: ${result.errors
                    .slice(0, 5)
                    .join('; ')}${result.errors.length > 5 ? ` (+${result.errors.length - 5} more)` : ''}`);
            }
        }
        catch (error) {
            // Contained on purpose. See the file comment.
            console.error('[house-heating] weather sync failed:', error);
        }
    }
    function start() {
        void catchUp();
        timer = setInterval(() => void catchUp(), ONE_HOUR_MS);
        // Does not hold the process open at shutdown.
        timer.unref?.();
    }
    function stop() {
        if (timer === null)
            return;
        clearInterval(timer);
        timer = null;
    }
    return { catchUp, start, stop, intervalMs: ONE_HOUR_MS };
}
