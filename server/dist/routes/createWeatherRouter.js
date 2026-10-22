"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWeatherRouter = createWeatherRouter;
const express_1 = require("express");
const calculations_js_1 = require("../services/calculations.js");
/**
 * A rejected promise inside an async Express 4 handler does NOT reach the
 * error middleware. It becomes an unhandled rejection and the REQUEST HANGS
 * until the client gives up. This wrapper is what makes async handlers safe.
 */
function asyncRoute(handler) {
    return (req, res, next) => {
        handler(req, res).catch(next);
    };
}
/**
 * Strict ISO calendar date. Deliberately rejects '2026-1-1' as well as
 * 'not-a-date': a single-digit month is ambiguous between formats and Postgres
 * would silently accept it under some DateStyle settings.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(value) {
    if (!ISO_DATE.test(value))
        return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    // Round-trips only if the calendar date actually exists: this is what
    // rejects 2026-02-30 and 2026-13-01.
    return (date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day);
}
/** null for absent, undefined for present-but-invalid. */
function readDateParam(raw) {
    if (raw === undefined || raw === '')
        return null;
    if (typeof raw !== 'string')
        return undefined;
    return isValidDate(raw) ? raw : undefined;
}
function createWeatherRouter({ weather, fetcher, }) {
    const router = (0, express_1.Router)();
    router.get('/', asyncRoute(async (req, res) => {
        const from = readDateParam(req.query.from);
        const to = readDateParam(req.query.to);
        if (from === undefined || to === undefined) {
            res
                .status(400)
                .json({ error: 'from and to must be ISO dates (YYYY-MM-DD) when provided' });
            return;
        }
        res.json(await weather.findRange(from, to));
    }));
    /**
     * Registered BEFORE any parameterised path so the literal 'summary' is not
     * read as a date.
     */
    router.get('/summary', asyncRoute(async (req, res) => {
        const from = readDateParam(req.query.from);
        const to = readDateParam(req.query.to);
        // An aggregate over an unbounded range is not a summary of anything
        // useful, so both bounds are required here even though GET / allows none.
        if (from === undefined || to === undefined || from === null || to === null) {
            res.status(400).json({
                error: 'from and to are both required ISO dates (YYYY-MM-DD)',
            });
            return;
        }
        res.json(await weather.summary(from, to));
    }));
    router.post('/', asyncRoute(async (req, res) => {
        const { date, max_temp: maxTemp, min_temp: minTemp, } = req.body ?? {};
        // Checked against undefined/null/'', NOT for truthiness. 0°C is an
        // ordinary Fort Smith day, not a missing value.
        const missing = [
            ['date', date],
            ['max_temp', maxTemp],
            ['min_temp', minTemp],
        ]
            .filter(([, value]) => value === undefined || value === null || value === '')
            .map(([name]) => name);
        if (missing.length > 0) {
            res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
            return;
        }
        const meanTemp = (0, calculations_js_1.calculateMeanTemp)(Number(minTemp), Number(maxTemp));
        const hdd = (0, calculations_js_1.calculateHDD)(meanTemp);
        const saved = await weather.save({
            date,
            maxTemp: Number(maxTemp),
            minTemp: Number(minTemp),
            meanTemp,
            hdd,
            source: 'manual',
        });
        res.status(201).json(saved);
    }));
    /**
     * Registered before the parameterised DELETE for the same reason /summary is:
     * a literal path must not be read as a date.
     */
    router.post('/fetch', asyncRoute(async (req, res) => {
        if (!fetcher) {
            res.status(503).json({
                error: 'Weather fetching is not configured on this server',
            });
            return;
        }
        const from = readDateParam(req.body?.from);
        const to = readDateParam(req.body?.to);
        if (from === undefined || to === undefined || from === null || to === null) {
            res
                .status(400)
                .json({ error: 'from and to are both required ISO dates (YYYY-MM-DD)' });
            return;
        }
        try {
            res.json(await fetcher.fetchRange(from, to));
        }
        catch (error) {
            // An inverted range is a BAD REQUEST, not a server fault. The fetcher
            // throws for it deliberately — rather than reporting a successful fetch
            // of zero days — so it is translated here instead of becoming a 500.
            const message = error instanceof Error ? error.message : String(error);
            if (/inverted range/i.test(message)) {
                res.status(400).json({ error: message });
                return;
            }
            throw error;
        }
    }));
    router.delete('/:date', asyncRoute(async (req, res) => {
        const date = req.params.date;
        if (!isValidDate(date)) {
            res.status(400).json({ error: 'date must be an ISO date (YYYY-MM-DD)' });
            return;
        }
        const removed = await weather.deleteByDate(date);
        if (!removed) {
            res.status(404).json({ error: 'No weather record for that date' });
            return;
        }
        res.status(204).send();
    }));
    return router;
}
