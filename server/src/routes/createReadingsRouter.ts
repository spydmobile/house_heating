import { Router, type Request, type Response, type NextFunction } from 'express';
import type { GaugeReading, NewGaugeReading } from '../repositories/PostgresGaugeReadingRepository.js';

/**
 * Gauge reading HTTP routes.
 *
 * Same pattern as createFillsRouter: the store is a PORT declared here and
 * satisfied by the Postgres repository at the edge.
 *
 * The old sqlite route (readings.ts) enriched each row with days_since_last,
 * liters_used, liters_per_day, hdd_period and liters_per_hdd — computed by
 * joining against weather_data in the same handler. That join crosses into
 * the weather store, which this router is not given, so the enrichment is
 * left out here rather than reached for with a new query. It is a real gap,
 * not an oversight — see the task report.
 *
 * The old route also had PUT /:id. GaugeReadingStore has no update method
 * (see PostgresGaugeReadingRepository — list/findById/save/deleteById only,
 * with save upserting on client_uuid), so PUT is left out rather than
 * inventing one.
 */
export interface GaugeReadingStore {
  list(): Promise<GaugeReading[]>;
  findById(id: number): Promise<GaugeReading | null>;
  save(reading: NewGaugeReading): Promise<GaugeReading>;
  deleteById(id: number): Promise<boolean>;
}

export interface ReadingsRouterDependencies {
  readings: GaugeReadingStore;
}

/**
 * A rejected promise inside an async Express 4 handler does NOT reach the
 * error middleware. It becomes an unhandled rejection and the REQUEST HANGS
 * until the client gives up. This wrapper is what makes async handlers safe.
 */
function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

/** Postgres rejects a non-numeric id as a type error; SQLite matched nothing. */
function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createReadingsRouter({ readings }: ReadingsRouterDependencies): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (_req, res) => {
      res.json(await readings.list());
    }),
  );

  router.get(
    '/:id',
    asyncRoute(async (req, res) => {
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
    }),
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const {
        date,
        gauge_percent: gaugePercent,
        notes,
        client_uuid: clientUuid,
      } = req.body ?? {};

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
    }),
  );

  router.delete(
    '/:id',
    asyncRoute(async (req, res) => {
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
    }),
  );

  return router;
}
