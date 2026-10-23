import { Router, type Request, type Response, type NextFunction } from 'express';
import type {
  HvacReport,
  NewHvacReport,
} from '../repositories/PostgresHvacReportRepository.js';
import type { MonthlyEfficiencyRow } from '../repositories/PostgresMonthlyEfficiencyQuery.js';

/**
 * HVAC report routes.
 *
 * THE BUG THE OLD ROUTE WOULD HAVE CARRIED INTO POSTGRES: it scoped a month's
 * fuel with `const endDate = \`${year}-${month}-31\`` for EVERY month. SQLite
 * compares dates as strings, so '2026-02-31' worked as an upper bound. Postgres
 * parses DATE and rejects it outright, so any February would have 500'd — and
 * that is the lucky outcome; the unlucky one is a string comparison quietly
 * including or excluding the wrong day.
 *
 * No date string is built here at all now. Month scoping lives in the read
 * model as EXTRACT(YEAR/MONTH FROM date), which cannot express an impossible
 * date.
 */

export interface HvacStore {
  list(): Promise<HvacReport[]>;
  findByMonth(year: number, month: number): Promise<HvacReport | null>;
  save(report: NewHvacReport): Promise<HvacReport>;
  deleteByMonth(year: number, month: number): Promise<boolean>;
}

/**
 * Narrow port onto the monthly read model. It already joins each report to its
 * fuel and degree days, so both `GET /` and `/analysis/efficiency` are shaped
 * from the same source rather than from two queries that could disagree.
 */
export interface MonthlyEfficiencySource {
  list(): Promise<MonthlyEfficiencyRow[]>;
}

export interface HvacRouterDependencies {
  hvac: HvacStore;
  efficiency: MonthlyEfficiencySource;
}

/**
 * A rejected promise in an async Express 4 handler never reaches the error
 * middleware — it hangs the request until the client gives up.
 */
function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

interface YearMonth {
  year: number;
  month: number;
}

/**
 * Validated here rather than at the database. Postgres rejects a non-numeric
 * year as a type error, which surfaces as a 500 and reads as the database being
 * unreachable — the most expensive possible way to report a typo in a URL.
 */
function parseYearMonth(rawYear: string, rawMonth: string): YearMonth | null {
  if (!/^\d{4}$/.test(rawYear) || !/^\d{1,2}$/.test(rawMonth)) return null;

  const year = Number(rawYear);
  const month = Number(rawMonth);

  if (month < 1 || month > 12) return null;

  return { year, month };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Litres per runtime hour. Null when no fuel was RECORDED — which is not zero
 * litres burned — and null when runtime is zero, which cannot be divided into.
 */
function litersPerHour(fuelLiters: number | null, runtimeHours: number): number | null {
  if (fuelLiters === null || runtimeHours <= 0) return null;

  return round(fuelLiters / runtimeHours, 3);
}

/** Litres per degree day. Litres per ZERO degree days is undefined, not zero. */
function litersPerHdd(fuelLiters: number | null, totalHdd: number | null): number | null {
  if (fuelLiters === null || totalHdd === null || totalHdd <= 0) return null;

  return round(fuelLiters / totalHdd, 3);
}

export function createHvacRouter({ hvac, efficiency }: HvacRouterDependencies): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (_req, res) => {
      const rows = await efficiency.list();

      res.json(
        rows.map((row) => ({
          ...row,
          litersPerRuntimeHour: litersPerHour(row.fuelLiters, row.totalRuntimeHours),
        })),
      );
    }),
  );

  /**
   * Registered BEFORE /:year/:month so the literal path is not read as a year.
   */
  router.get(
    '/analysis/efficiency',
    asyncRoute(async (_req, res) => {
      const rows = await efficiency.list();

      res.json(
        rows.map((row) => ({
          period: `${row.year}-${String(row.month).padStart(2, '0')}`,
          year: row.year,
          month: row.month,
          runtimeHours: row.totalRuntimeHours,
          avgCycleMinutes: row.avgCycleMinutes,
          avgOutdoorTemp: row.avgOutdoorTemp,
          fuelLiters: row.fuelLiters,
          totalHdd: row.totalHdd === null ? null : round(row.totalHdd, 1),
          // Travels with the total: an L/HDD from six days of January and one
          // from thirty-one look identical without it, and only one is usable.
          weatherDays: row.weatherDays,
          litersPerHour: litersPerHour(row.fuelLiters, row.totalRuntimeHours),
          litersPerHdd: litersPerHdd(row.fuelLiters, row.totalHdd),
        })),
      );
    }),
  );

  router.get(
    '/:year/:month',
    asyncRoute(async (req, res) => {
      const parsed = parseYearMonth(req.params.year, req.params.month);

      if (!parsed) {
        res.status(400).json({ error: 'year must be YYYY and month must be 1-12' });
        return;
      }

      const report = await hvac.findByMonth(parsed.year, parsed.month);

      if (!report) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }

      res.json(report);
    }),
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const {
        year,
        month,
        total_runtime_hours: totalRuntimeHours,
        avg_cycle_minutes: avgCycleMinutes,
        avg_outdoor_temp: avgOutdoorTemp,
        avg_indoor_temp: avgIndoorTemp,
        avg_setpoint: avgSetpoint,
        notes,
      } = req.body ?? {};

      // Against undefined/null/'', never truthiness. A runtime of 0 hours is a
      // real reading for a summer month, and the original's `!year || !month`
      // would have rejected a legitimate zero on any field guarded that way.
      const missing = [
        ['year', year],
        ['month', month],
        ['total_runtime_hours', totalRuntimeHours],
      ]
        .filter(([, value]) => value === undefined || value === null || value === '')
        .map(([name]) => name);

      if (missing.length > 0) {
        res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
        return;
      }

      const parsed = parseYearMonth(String(year), String(month));

      if (!parsed) {
        res.status(400).json({ error: 'year must be YYYY and month must be 1-12' });
        return;
      }

      // `?? null`, not `|| null`. The original turned a genuine 0 °C average
      // outdoor temperature into NULL, and 0 °C is an ordinary spring day here.
      const saved = await hvac.save({
        year: parsed.year,
        month: parsed.month,
        totalRuntimeHours: Number(totalRuntimeHours),
        avgCycleMinutes: avgCycleMinutes ?? null,
        avgOutdoorTemp: avgOutdoorTemp ?? null,
        avgIndoorTemp: avgIndoorTemp ?? null,
        avgSetpoint: avgSetpoint ?? null,
        notes: notes ?? null,
      });

      res.status(201).json(saved);
    }),
  );

  router.delete(
    '/:year/:month',
    asyncRoute(async (req, res) => {
      const parsed = parseYearMonth(req.params.year, req.params.month);

      if (!parsed) {
        res.status(400).json({ error: 'year must be YYYY and month must be 1-12' });
        return;
      }

      const removed = await hvac.deleteByMonth(parsed.year, parsed.month);

      if (!removed) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }

      res.status(204).send();
    }),
  );

  return router;
}
