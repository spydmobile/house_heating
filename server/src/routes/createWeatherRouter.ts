import { Router, type Request, type Response, type NextFunction } from 'express';
import { calculateMeanTemp, calculateHDD } from '../services/calculations.js';
import type { WeatherDay, NewWeatherDay } from '../repositories/PostgresWeatherRepository.js';

/**
 * Weather HTTP routes.
 *
 * No client_uuid passthrough or validation here, deliberately: weather is
 * written by the server from Environment Canada, never queued offline on a
 * phone (see PostgresWeatherRepository).
 *
 * The old sqlite route (weather.ts) supported several things this router
 * does not, each left out rather than reinvented in SQL here because
 * PostgresWeatherRepository has no method that expresses it:
 *   - GET / with no filter, or only `from`, or only `to`. The repository
 *     only exposes findBetween(from, to), so this router requires both
 *     bounds and 400s otherwise.
 *   - GET /summary (avg_temp/min_temp/max_temp). The repository has
 *     totalHdd/countDays but no temperature aggregates, so a correct
 *     summary cannot be built from what exists — left out entirely rather
 *     than shipped partial.
 *   - POST /fetch (Environment Canada pull via weatherFetcher.ts). That
 *     service writes through the old sqlite db directly, not through this
 *     store, and converting it is outside the four files in scope here.
 *   - DELETE /:date. The repository has no deleteByDate (or any delete)
 *     method, so there is nothing to call.
 */
export interface WeatherStore {
  findBetween(from: string, to: string): Promise<WeatherDay[]>;
  save(day: NewWeatherDay): Promise<WeatherDay>;
}

export interface WeatherRouterDependencies {
  weather: WeatherStore;
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

export function createWeatherRouter({ weather }: WeatherRouterDependencies): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      const { from, to } = req.query;

      if (typeof from !== 'string' || typeof to !== 'string' || from === '' || to === '') {
        res.status(400).json({ error: 'Both from and to query parameters required' });
        return;
      }

      res.json(await weather.findBetween(from, to));
    }),
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const {
        date,
        max_temp: maxTemp,
        min_temp: minTemp,
      } = req.body ?? {};

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

      const meanTemp = calculateMeanTemp(Number(minTemp), Number(maxTemp));
      const hdd = calculateHDD(meanTemp);

      const saved = await weather.save({
        date,
        maxTemp: Number(maxTemp),
        minTemp: Number(minTemp),
        meanTemp,
        hdd,
        source: 'manual',
      });

      res.status(201).json(saved);
    }),
  );

  return router;
}
