import { Router, type Request, type Response, type NextFunction } from 'express';
import { calculateFillCost, estimateLiters } from '../services/calculations.js';
import type { FuelFill, NewFuelFill } from '../repositories/PostgresFuelFillRepository.js';

/**
 * Fuel fill HTTP routes.
 *
 * The store is a PORT declared here and satisfied by the Postgres repository at
 * the edge — so these routes can be exercised over real HTTP with no database,
 * and the driver could change without touching them.
 */
export interface FuelFillStore {
  list(): Promise<FuelFill[]>;
  findById(id: number): Promise<FuelFill | null>;
  save(fill: NewFuelFill): Promise<FuelFill>;
  deleteById(id: number): Promise<boolean>;
}

export interface FillsRouterDependencies {
  fills: FuelFillStore;
}

/**
 * A rejected promise inside an async Express 4 handler does NOT reach the error
 * middleware. It becomes an unhandled rejection and the REQUEST HANGS until the
 * client gives up — which on a phone at the oil tank means a fill that appears
 * to be submitting forever. This wrapper is what makes async handlers safe, and
 * it is the single most likely new fault from the sync-to-async move.
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

export function createFillsRouter({ fills }: FillsRouterDependencies): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (_req, res) => {
      res.json(await fills.list());
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

      const fill = await fills.findById(id);

      if (!fill) {
        res.status(404).json({ error: 'Fill not found' });
        return;
      }

      res.json(fill);
    }),
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const {
        date,
        gauge_percent_before: gaugePercentBefore,
        liters_added: litersAdded,
        price_per_liter: pricePerLiter,
        notes,
        client_uuid: clientUuid,
      } = req.body ?? {};

      // gauge_percent_before is NOT in this list, deliberately. The gauge is
      // sometimes genuinely not read — the real 2026-02-24 delivery recorded
      // "Gauge before fill unknown" — and when the column was NOT NULL the only
      // way to file that fill was to type 0, which asserts an EMPTY TANK. The
      // schema manufactured a measurement nobody took. Absent now means absent.
      //
      // The fill itself is still required to be real: its date, its litres and
      // its price all happened regardless of whether anyone read the gauge.
      //
      // Checked against undefined, NOT for truthiness, because a gauge reading
      // of 0 remains a legitimate value and a falsy check would reject it.
      const missing = [
        ['date', date],
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

      const cost = calculateFillCost(Number(litersAdded), Number(pricePerLiter));

      // An unknown gauge reading yields an unknown volume. estimateLiters(0)
      // would be 0 litres before the fill — restating the same fabrication one
      // column over, and in the column the analysis actually reads.
      const gaugeUnknown =
        gaugePercentBefore === undefined || gaugePercentBefore === null || gaugePercentBefore === '';

      const saved = await fills.save({
        clientUuid: clientUuid ?? null,
        date,
        gaugePercentBefore: gaugeUnknown ? null : Number(gaugePercentBefore),
        litersAdded: Number(litersAdded),
        litersBeforeFill: gaugeUnknown ? null : estimateLiters(Number(gaugePercentBefore)),
        pricePerLiter: Number(pricePerLiter),
        discount: cost.discount,
        gst: cost.gst,
        totalCost: cost.total,
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

      const removed = await fills.deleteById(id);

      if (!removed) {
        res.status(404).json({ error: 'Fill not found' });
        return;
      }

      res.status(204).send();
    }),
  );

  return router;
}
