"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReadingsRouter = createReadingsRouter;
const express_1 = require("express");
const enrichReadings_js_1 = require("../services/enrichReadings.js");
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
/** Postgres rejects a non-numeric id as a type error; SQLite matched nothing. */
function parseId(raw) {
    if (!/^\d+$/.test(raw))
        return null;
    return Number(raw);
}
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function createReadingsRouter({ readings, weather, }) {
    const router = (0, express_1.Router)();
    router.get('/', asyncRoute(async (_req, res) => {
        const stored = await readings.list();
        // The periods are known only once the readings are ordered, so the HDD
        // lookups are gathered first and the pure enrichment then reads from the
        // resolved map. This keeps `enrichReadings` synchronous and total.
        const periods = stored
            .slice(0, -1)
            .map((reading, index) => [stored[index + 1].date, reading.date]);
        const hddByPeriod = new Map();
        for (const [from, to] of periods) {
            hddByPeriod.set(`${from}|${to}`, await weather.hddForPeriod(from, to));
        }
        res.json((0, enrichReadings_js_1.enrichReadings)(stored, (from, to) => hddByPeriod.get(`${from}|${to}`) ?? null));
    }));
    router.get('/:id', asyncRoute(async (req, res) => {
        const id = parseId(req.params.id);
        if (id === null) {
            res.status(400).json({ error: 'id must be a number' });
            return;
        }
        const reading = await readings.findById(id);
        if (!reading) {
            res.status(404).json({ error: 'Reading not found' });
            return;
        }
        res.json(reading);
    }));
    router.post('/', asyncRoute(async (req, res) => {
        const { date, gauge_percent: gaugePercent, notes, client_uuid: clientUuid, } = req.body ?? {};
        // Checked against undefined/null/'', NOT for truthiness. A gauge
        // reading of 0 is a value, same reasoning as createFillsRouter.
        const missing = [
            ['date', date],
            ['gauge_percent', gaugePercent],
        ]
            .filter(([, value]) => value === undefined || value === null || value === '')
            .map(([name]) => name);
        if (missing.length > 0) {
            res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
            return;
        }
        if (clientUuid !== undefined && clientUuid !== null) {
            if (typeof clientUuid !== 'string' || !UUID_PATTERN.test(clientUuid)) {
                res.status(400).json({ error: 'client_uuid must be a UUID' });
                return;
            }
        }
        const saved = await readings.save({
            clientUuid: clientUuid ?? null,
            date,
            gaugePercent: Number(gaugePercent),
            notes: notes ?? null,
        });
        res.status(201).json(saved);
    }));
    router.put('/:id', asyncRoute(async (req, res) => {
        const id = parseId(req.params.id);
        if (id === null) {
            res.status(400).json({ error: 'id must be a number' });
            return;
        }
        const { date, gauge_percent: gaugePercent, notes } = req.body ?? {};
        // Against undefined/null/'', never truthiness: a corrected gauge reading
        // of 0 is a value.
        const missing = [
            ['date', date],
            ['gauge_percent', gaugePercent],
        ]
            .filter(([, value]) => value === undefined || value === null || value === '')
            .map(([name]) => name);
        if (missing.length > 0) {
            res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
            return;
        }
        const updated = await readings.update(id, {
            date,
            gaugePercent: Number(gaugePercent),
            notes: notes ?? null,
        });
        // Null means no row had that id — a 404, not a success that changed
        // nothing.
        if (!updated) {
            res.status(404).json({ error: 'Reading not found' });
            return;
        }
        res.json(updated);
    }));
    router.delete('/:id', asyncRoute(async (req, res) => {
        const id = parseId(req.params.id);
        if (id === null) {
            res.status(400).json({ error: 'id must be a number' });
            return;
        }
        const removed = await readings.deleteById(id);
        if (!removed) {
            res.status(404).json({ error: 'Reading not found' });
            return;
        }
        res.status(204).send();
    }));
    return router;
}
