import { Router, type Request, type Response, type NextFunction } from 'express';
import { calculateMeanTemp, calculateHDD } from '../services/calculations.js';
import type {
  WeatherDay,
  NewWeatherDay,
  WeatherSummary,
} from '../repositories/PostgresWeatherRepository.js';

/**
 * Weather HTTP routes.
 *
 * No client_uuid passthrough or validation here, deliberately: weather is
 * written by the server from Environment Canada, never queued offline on a
 * phone (see PostgresWeatherRepository).
 *
 * GET / takes OPTIONAL bounds. The client's `getWeather(from?, to?)` builds an
 * empty query string when called with no arguments, and Dashboard.tsx calls it
 * that way — so requiring both bounds would 400 the dashboard's weather panel.
 *
 * Every date arriving from the query string or the path is validated HERE.
 * Postgres rejects a malformed date as a type error, which surfaces as a 500
 * and is then indistinguishable from the database being unreachable. A bad
 * request should say it is a bad request.
 *
 * STILL MISSING, and named rather than quietly dropped: POST /fetch, the
 * Environment Canada pull. `weatherFetcher.ts` writes through the old sqlite
 * handle directly rather than through this store, so restoring the endpoint
 * means converting that service first.
 */
export interface WeatherStore {
  findRange(from: string | null, to: string | null): Promise<WeatherDay[]>;
  findBetween(from: string, to: string): Promise<WeatherDay[]>;
  summary(from: string, to: string): Promise<WeatherSummary>;
  deleteByDate(date: string): Promise<boolean>;
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

/**
 * Strict ISO calendar date. Deliberately rejects '2026-1-1' as well as
 * 'not-a-date': a single-digit month is ambiguous between formats and Postgres
 * would silently accept it under some DateStyle settings.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  // Round-trips only if the calendar date actually exists: this is what
  // rejects 2026-02-30 and 2026-13-01.
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** null for absent, undefined for present-but-invalid. */
function readDateParam(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  return isValidDate(raw) ? raw : undefined;
}

export function createWeatherRouter({ weather }: WeatherRouterDependencies): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      const from = readDateParam(req.query.from);
      const to = readDateParam(req.query.to);

      if (from === undefined || to === undefined) {
        res
          .status(400)
          .json({ error: 'from and to must be ISO dates (YYYY-MM-DD) when provided' });
        return;
      }

      res.json(await weather.findRange(from, to));
    }),
  );

  /**
   * Registered BEFORE any parameterised path so the literal 'summary' is not
   * read as a date.
   */
  router.get(
    '/summary',
    asyncRoute(async (req, res) => {
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

  router.delete(
    '/:date',
    asyncRoute(async (req, res) => {
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
    }),
  );

  return router;
}
