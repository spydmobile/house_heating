"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFillsRouter = createFillsRouter;
const express_1 = require("express");
const calculations_js_1 = require("../services/calculations.js");
/**
 * A rejected promise inside an async Express 4 handler does NOT reach the error
 * middleware. It becomes an unhandled rejection and the REQUEST HANGS until the
 * client gives up — which on a phone at the oil tank means a fill that appears
 * to be submitting forever. This wrapper is what makes async handlers safe, and
 * it is the single most likely new fault from the sync-to-async move.
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
function createFillsRouter({ fills }) {
    const router = (0, express_1.Router)();
    router.get('/', asyncRoute(async (_req, res) => {
        res.json(await fills.list());
    }));
    router.get('/:id', asyncRoute(async (req, res) => {
        const id = parseId(req.params.id);
        if (id === null) {
            res.status(400).json({ error: 'id must be a number' });
            return;
        }
        const fill = await fills.findById(id);
        if (!fill) {
            res.status(404).json({ error: 'Fill not found' });
            return;
        }
        res.json(fill);
    }));
    router.post('/', asyncRoute(async (req, res) => {
        const { date, gauge_percent_before: gaugePercentBefore, liters_added: litersAdded, price_per_liter: pricePerLiter, notes, client_uuid: clientUuid, } = req.body ?? {};
        // Checked against undefined, NOT for truthiness. A gauge reading of 0 is
        // a value — it is exactly what the real 2026-02-24 row recorded — and a
        // falsy check would reject it as missing.
        const missing = [
            ['date', date],
            ['gauge_percent_before', gaugePercentBefore],
            ['liters_added', litersAdded],
            ['price_per_liter', pricePerLiter],
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
        const cost = (0, calculations_js_1.calculateFillCost)(Number(litersAdded), Number(pricePerLiter));
        const saved = await fills.save({
            clientUuid: clientUuid ?? null,
            date,
            gaugePercentBefore: Number(gaugePercentBefore),
            litersAdded: Number(litersAdded),
            litersBeforeFill: (0, calculations_js_1.estimateLiters)(Number(gaugePercentBefore)),
            pricePerLiter: Number(pricePerLiter),
            discount: cost.discount,
            gst: cost.gst,
            totalCost: cost.total,
            notes: notes ?? null,
        });
        res.status(201).json(saved);
    }));
    router.delete('/:id', asyncRoute(async (req, res) => {
        const id = parseId(req.params.id);
        if (id === null) {
            res.status(400).json({ error: 'id must be a number' });
            return;
        }
        const removed = await fills.deleteById(id);
        if (!removed) {
            res.status(404).json({ error: 'Fill not found' });
            return;
        }
        res.status(204).send();
    }));
    return router;
}
