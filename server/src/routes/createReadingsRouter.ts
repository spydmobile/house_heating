import { Router, type Request, type Response, type NextFunction } from 'express';
import type {
  GaugeReading,
  GaugeReadingEdit,
  NewGaugeReading,
} from '../repositories/PostgresGaugeReadingRepository.js';
import { enrichReadings } from '../services/enrichReadings.js';

/**
 * Gauge reading HTTP routes.
 *
 * Same pattern as createFillsRouter: the store is a PORT declared here and
 * satisfied by the Postgres repository at the edge.
 *
 * GET / is ENRICHED with days_since_last, liters_used, liters_per_day,
 * hdd_period and liters_per_hdd, as the old sqlite route was. The arithmetic
 * lives in `enrichReadings` as a pure function and the degree days come from
 * the weather store, so this handler composes rather than computes.
 *
 * Two stores, deliberately: the enrichment genuinely spans readings and
 * weather. `ReadingsWeatherStore` is a NARROW port — one method, the only one
 * this router needs — rather than the whole weather repository, so a reading
 * route cannot reach for weather writes.
 *
 * The old route ran its HDD query inside a `.map()`, one query per reading.
 * That shape is gone; the lookup is injected and the periods are requested
 * through it.
 */
export interface GaugeReadingStore {
  list(): Promise<GaugeReading[]>;
  findById(id: number): Promise<GaugeReading | null>;
  save(reading: NewGaugeReading): Promise<GaugeReading>;
  update(id: number, edit: GaugeReadingEdit): Promise<GaugeReading | null>;
  deleteById(id: number): Promise<boolean>;
}

/**
 * Narrow port: the one weather fact this router needs.
 *
 * `hddForPeriod` returns null for a period with NO weather data, which is not
 * zero degree days. Only the repository can tell those apart, and the
 * difference decides whether an efficiency figure may be computed at all.
 */
export interface ReadingsWeatherStore {
  hddForPeriod(from: string, to: string): Promise<number | null>;
}

export interface ReadingsRouterDependencies {
  readings: GaugeReadingStore;
  weather: ReadingsWeatherStore;
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

export function createReadingsRouter({
  readings,
  weather,
}: ReadingsRouterDependencies): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (_req, res) => {
      const stored = await readings.list();

      // The periods are known only once the readings are ordered, so the HDD
      // lookups are gathered first and the pure enrichment then reads from the
      // resolved map. This keeps `enrichReadings` synchronous and total.
      const periods = stored
        .slice(0, -1)
        .map((reading, index) => [stored[index + 1].date, reading.date] as const);

      const hddByPeriod = new Map<string, number | null>();

      for (const [from, to] of periods) {
        hddByPeriod.set(`${from}|${to}`, await weather.hddForPeriod(from, to));
      }

      res.json(
        enrichReadings(stored, (from, to) => hddByPeriod.get(`${from}|${to}`) ?? null),
      );
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

  router.put(
    '/:id',
    asyncRoute(async (req, res) => {
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
