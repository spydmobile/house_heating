import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  estimateLiters,
  calculateEfficiency,
  predictDaysUntilRefill,
  predictRefillDate,
  getTypicalHDDForMonth,
  typicalHDDByMonth,
} from '../services/calculations.js';
import { config } from '../config.js';
import { measureEfficiency, type EfficiencyPeriod } from '../services/measureEfficiency.js';
import type { ForecastDay } from '../services/forecastFetcher.js';
import type { FuelFill } from '../repositories/PostgresFuelFillRepository.js';
import type { GaugeReading } from '../repositories/PostgresGaugeReadingRepository.js';
import type {
  FillsAfterTotals,
  FillsBetweenTotals,
  HddBetweenTotals,
  EfficiencyWeatherSummary,
} from '../repositories/PostgresAnalysisQuery.js';

/**
 * Analysis HTTP routes — tank status, refill predictions, period efficiency,
 * and cost rollups. Four narrow ports rather than one wide one, because each
 * route only ever touches a slice of these:
 *
 *   /current      reads the latest reading + fill, and HDD around them
 *   /predictions  reads the latest reading + a live forecast
 *   /efficiency   reads fuel and weather totals for a period
 *   /costs        reads every fill and the all-time weather total
 *
 * Every aggregate port method returns null for "no data" and a real number
 * for a measured zero — see PostgresAnalysisQuery, which backs these in
 * production. The arithmetic below preserves the original sqlite route's own
 * truthy guards around those aggregates (e.g. "only compute an efficiency
 * ratio when the HDD total is both present and non-zero") since dividing by
 * zero HDD is exactly as undefined as dividing by absent HDD.
 */

export interface AnalysisFillsStore {
  list(): Promise<FuelFill[]>;
  latest(): Promise<FuelFill | null>;
  addedAfter(date: string): Promise<FillsAfterTotals>;
  between(from: string, to: string): Promise<FillsBetweenTotals>;
}

export interface AnalysisReadingsStore {
  latest(): Promise<GaugeReading | null>;
  /** All readings, date DESC. Needed to build consumption periods. */
  list(): Promise<GaugeReading[]>;
}

export interface AnalysisWeatherStore {
  hddBetweenExclusive(from: string, to: string): Promise<HddBetweenTotals>;
  summaryForEfficiency(from: string, to: string): Promise<EfficiencyWeatherSummary>;
  totalHddAllTime(): Promise<number | null>;
}

/** Matches forecastFetcher.ts's own return shape — no adapter needed at the wiring edge. */
export interface ForecastProvider {
  fetchForecast(): Promise<{ forecast: ForecastDay[]; avg_hdd_per_day: number }>;
}

export interface AnalysisRouterDependencies {
  fills: AnalysisFillsStore;
  readings: AnalysisReadingsStore;
  weather: AnalysisWeatherStore;
  forecast: ForecastProvider;
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
 * Strict ISO calendar date, same validator as createWeatherRouter.ts.
 * Deliberately rejects '2026-1-1' and 2026-02-30: a single-digit month is
 * ambiguous between formats, and Postgres would reject the bad calendar date
 * as a type error that reads as the database being down rather than a 400.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days between two YYYY-MM-DD dates, in UTC. Fort Smith observes DST, so
 * local-time parsing yields 23- and 25-hour days twice a year, and a rounded
 * difference across one of those boundaries lands a day out — which would shift
 * the denominator of a consumption rate.
 */
function daysBetween(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  const [ty, tm, td] = toDate.split('-').map(Number);

  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function createAnalysisRouter({
  fills,
  readings,
  weather,
  forecast,
}: AnalysisRouterDependencies): Router {
  const router = Router();

  // Get current tank status and efficiency
  router.get(
    '/current',
    asyncRoute(async (_req, res) => {
      const latestReading = await readings.latest();
      const latestFill = await fills.latest();

      if (!latestReading) {
        res.json({ error: 'No readings available' });
        return;
      }

      const readingLiters = estimateLiters(latestReading.gaugePercent);
      const readingDate = new Date(latestReading.date);
      const today = new Date().toISOString().split('T')[0];

      let consumptionSinceFill: number | null = null;
      let daysSinceFill: number | null = null;
      let efficiencySinceFill: number | null = null;

      if (latestFill) {
        const fillDate = new Date(latestFill.date);
        const daysBetween = Math.round(
          (readingDate.getTime() - fillDate.getTime()) / MS_PER_DAY,
        );

        if (daysBetween >= 0) {
          // Reading is after fill — can calculate consumption
          daysSinceFill = daysBetween;
          consumptionSinceFill = config.tankCapacity - readingLiters;

          const weatherSummary = await weather.hddBetweenExclusive(
            latestFill.date,
            latestReading.date,
          );

          // Guards against BOTH absent and zero HDD deliberately — a ratio
          // over 0 HDD is exactly as undefined as one over no data at all,
          // matching calculateEfficiency's own internal guard.
          if (weatherSummary.totalHdd && consumptionSinceFill > 0) {
            efficiencySinceFill = calculateEfficiency(
              consumptionSinceFill,
              weatherSummary.totalHdd,
            );
          }
        } else {
          // Fill is after reading — calculate days since the newer fill
          daysSinceFill = Math.round(
            (new Date(today).getTime() - fillDate.getTime()) / MS_PER_DAY,
          );
        }
      }

      // Use recent efficiency or fall back to typical
      const efficiency = efficiencySinceFill || 0.4; // Default to 0.4 L/HDD

      // PROJECT CURRENT LEVEL: weather since the reading, plus any fills that
      // occurred after it.
      let projectedLiters = readingLiters;
      let hddSinceReading: number | null = null;
      let consumptionSinceReading: number | null = null;
      let daysSinceReading = 0;
      let fillsSinceReading = 0;

      const fillsSinceReadingResult = await fills.addedAfter(latestReading.date);

      if (fillsSinceReadingResult.totalAdded) {
        projectedLiters += fillsSinceReadingResult.totalAdded;
        fillsSinceReading = fillsSinceReadingResult.count;
      }

      if (latestReading.date < today) {
        const weatherSinceReading = await weather.hddBetweenExclusive(
          latestReading.date,
          today,
        );

        if (weatherSinceReading.totalHdd) {
          hddSinceReading = weatherSinceReading.totalHdd;
          daysSinceReading = weatherSinceReading.days;
          consumptionSinceReading = efficiency * hddSinceReading;
          projectedLiters = Math.max(0, projectedLiters - consumptionSinceReading);
        }
      }

      projectedLiters = Math.min(projectedLiters, config.tankCapacity);
      const projectedPercent = (projectedLiters / config.tankCapacity) * 100;

      const currentMonth = new Date().getMonth() + 1;
      const typicalHDD = getTypicalHDDForMonth(currentMonth);

      const daysUntilRefill = predictDaysUntilRefill(projectedLiters, efficiency, typicalHDD);
      const refillDate = predictRefillDate(new Date(), projectedLiters, efficiency, typicalHDD);

      res.json({
        tank: {
          reading_liters: Math.round(readingLiters),
          reading_percent: latestReading.gaugePercent,
          reading_date: latestReading.date,
          current_liters: Math.round(projectedLiters),
          current_percent: Math.round(projectedPercent),
          capacity: config.tankCapacity,
          projection: {
            hdd_since_reading: hddSinceReading ? round(hddSinceReading, 1) : null,
            consumption_since_reading: consumptionSinceReading
              ? round(consumptionSinceReading, 1)
              : null,
            days_since_reading: daysSinceReading,
            efficiency_used: round(efficiency, 3),
          },
        },
        consumption: {
          since_fill_liters: consumptionSinceFill ? Math.round(consumptionSinceFill) : null,
          days_since_fill: daysSinceFill,
          liters_per_day:
            consumptionSinceReading && daysSinceReading
              ? round(consumptionSinceReading / daysSinceReading, 2)
              : daysSinceFill && consumptionSinceFill
                ? round(consumptionSinceFill / daysSinceFill, 2)
                : null,
        },
        efficiency: {
          current_l_per_hdd: efficiencySinceFill ? round(efficiencySinceFill, 3) : null,
          baseline_q1_2025: 0.191, // Old windows baseline
        },
        prediction: {
          days_until_refill: Math.round(daysUntilRefill),
          estimated_refill_date: refillDate.toISOString().split('T')[0],
          assumed_hdd_per_day: typicalHDD,
          assumed_efficiency: round(efficiency, 3),
        },
      });
    }),
  );

  // Get refill predictions using real forecast + measured efficiency
  router.get(
    '/predictions',
    asyncRoute(async (_req, res) => {
      const latestReading = await readings.latest();

      if (!latestReading) {
        res.json({ error: 'No readings available' });
        return;
      }

      const readingLiters = estimateLiters(latestReading.gaugePercent);
      const todayStr = new Date().toISOString().split('T')[0];

      /*
       * MEASURED, or nothing. This used to be `const efficiency = 0.4` with a
       * TODO beside it — in a file that records 0.191 L/HDD as the old-windows
       * baseline, so every refill date came from a number more than double the
       * project's own figure.
       *
       * A period counts only if it is complete in both senses: no fill inside
       * it, and weather for every one of its days. Incomplete weather INFLATES
       * the ratio, because the litres consumed are real while the degree days
       * are undercounted — and that inflated number would then drive the
       * prediction.
       *
       * Franco's ruling, 2026-10-20: refuse to predict and say why.
       */
      const allReadings = await readings.list();
      const periods: EfficiencyPeriod[] = [];

      for (let index = 0; index < allReadings.length - 1; index += 1) {
        const current = allReadings[index];
        const previous = allReadings[index + 1];

        const [weatherForPeriod, fillsInPeriod] = await Promise.all([
          weather.hddBetweenExclusive(previous.date, current.date),
          fills.between(previous.date, current.date),
        ]);

        const litersUsed =
          estimateLiters(previous.gaugePercent) - estimateLiters(current.gaugePercent);

        periods.push({
          from: previous.date,
          to: current.date,
          days: daysBetween(previous.date, current.date),
          // A gauge that rose means a fill; consumption is unknown, not negative.
          litersUsed: litersUsed < 0 ? null : litersUsed,
          hdd: weatherForPeriod.totalHdd,
          weatherDays: weatherForPeriod.days,
          hadFill: fillsInPeriod.count > 0,
        });
      }

      const measured = measureEfficiency(periods);

      const efficiencyReport = {
        measured: measured.litersPerHdd === null ? null : round(measured.litersPerHdd, 3),
        used: measured.litersPerHdd === null ? null : round(measured.litersPerHdd, 3),
        source:
          measured.litersPerHdd === null
            ? 'unavailable'
            : 'measured from complete consumption periods',
        reason: measured.reason,
        qualifying_periods: measured.qualifyingPeriods,
        total_liters: round(measured.totalLiters, 1),
        total_hdd: round(measured.totalHdd, 1),
        total_days: measured.totalDays,
        from: measured.from,
        to: measured.to,
        excluded: measured.excluded,
      };

      /*
       * REFUSE. Everything below this point is efficiency-driven, so producing
       * any of it would mean inventing the input. The observed tank level is
       * still reported — it is measured, not derived.
       */
      if (measured.litersPerHdd === null) {
        const observedLiters = Math.min(
          Math.max(0, readingLiters),
          config.tankCapacity,
        );

        res.json({
          current_tank: {
            liters: Math.round(observedLiters),
            percent: Math.round((observedLiters / config.tankCapacity) * 100),
            as_of: latestReading.date,
          },
          efficiency: efficiencyReport,
          forecast_based_prediction: null,
          forecast: null,
          scenarios: [],
          typical_hdd_by_month: typicalHDDByMonth,
        });
        return;
      }

      const efficiency = measured.litersPerHdd;

      let currentLiters = readingLiters;

      const fillsSinceReading = await fills.addedAfter(latestReading.date);

      if (fillsSinceReading.totalAdded) {
        currentLiters += fillsSinceReading.totalAdded;
      }

      if (latestReading.date < todayStr) {
        const weatherSinceReading = await weather.hddBetweenExclusive(
          latestReading.date,
          todayStr,
        );

        if (weatherSinceReading.totalHdd) {
          currentLiters -= efficiency * weatherSinceReading.totalHdd;
        }
      }

      currentLiters = Math.min(Math.max(0, currentLiters), config.tankCapacity);

      // Fetch 7-day forecast
      let forecastDays: ForecastDay[] = [];
      let forecastHDDPerDay = 25; // Default if forecast fails

      try {
        const forecastData = await forecast.fetchForecast();
        forecastDays = forecastData.forecast;
        forecastHDDPerDay = forecastData.avg_hdd_per_day;
      } catch (err) {
        console.error('Failed to fetch forecast:', err);
      }

      let remainingLiters = currentLiters;
      let daysUntilRefill = 0;
      const refillThreshold = config.tankCapacity * 0.2; // Refill at 20%
      const dailyProjection: Array<{
        date: string;
        hdd: number;
        fuel_used: number;
        remaining_liters: number;
        remaining_percent: number;
      }> = [];

      const today = new Date();
      while (remainingLiters > refillThreshold && daysUntilRefill < 120) {
        const projDate = new Date(today);
        projDate.setDate(projDate.getDate() + daysUntilRefill);
        const dateStr = projDate.toISOString().split('T')[0];

        let dayHDD: number;
        if (daysUntilRefill < forecastDays.length) {
          dayHDD = forecastDays[daysUntilRefill].hdd;
        } else {
          const month = projDate.getMonth() + 1;
          dayHDD = getTypicalHDDForMonth(month);
        }

        const fuelUsed = efficiency * dayHDD;
        remainingLiters -= fuelUsed;

        if (daysUntilRefill < 14) {
          dailyProjection.push({
            date: dateStr,
            hdd: round(dayHDD, 1),
            fuel_used: round(fuelUsed, 1),
            remaining_liters: Math.round(Math.max(0, remainingLiters)),
            remaining_percent: Math.round(
              (Math.max(0, remainingLiters) / config.tankCapacity) * 100,
            ),
          });
        }

        daysUntilRefill++;
      }

      const refillDate = new Date(today);
      refillDate.setDate(refillDate.getDate() + daysUntilRefill);

      const scenarios = [
        { name: '7-Day Forecast Avg', hdd_per_day: forecastHDDPerDay },
        { name: 'Mild (-10°C avg)', hdd_per_day: 28 },
        { name: 'Normal (-20°C avg)', hdd_per_day: 38 },
        { name: 'Cold (-30°C avg)', hdd_per_day: 48 },
      ];

      const scenarioPredictions = scenarios.map((scenario) => {
        const days = predictDaysUntilRefill(currentLiters, efficiency, scenario.hdd_per_day);
        const date = predictRefillDate(new Date(), currentLiters, efficiency, scenario.hdd_per_day);
        const dailyFuel = efficiency * scenario.hdd_per_day;

        return {
          scenario: scenario.name,
          hdd_per_day: round(scenario.hdd_per_day, 1),
          daily_fuel_liters: round(dailyFuel, 1),
          days_until_refill: Math.round(days),
          estimated_refill_date: date.toISOString().split('T')[0],
        };
      });

      res.json({
        current_tank: {
          liters: Math.round(currentLiters),
          percent: Math.round((currentLiters / config.tankCapacity) * 100),
          as_of: latestReading.date,
        },
        efficiency: efficiencyReport,
        forecast_based_prediction: {
          days_until_refill: daysUntilRefill,
          estimated_refill_date: refillDate.toISOString().split('T')[0],
          refill_threshold_percent: 20,
          daily_projection: dailyProjection,
        },
        forecast:
          forecastDays.length > 0
            ? {
                source: 'Open-Meteo',
                days: forecastDays,
                avg_hdd_per_day: forecastHDDPerDay,
              }
            : null,
        scenarios: scenarioPredictions,
        typical_hdd_by_month: typicalHDDByMonth,
      });
    }),
  );

  // Get efficiency for a specific period (e.g., Q1 comparison)
  router.get(
    '/efficiency',
    asyncRoute(async (req, res) => {
      const { from, to, period } = req.query;

      let fromDate: string;
      let toDate: string;

      if (period === 'q1_2025') {
        fromDate = '2025-01-01';
        toDate = '2025-03-31';
      } else if (period === 'q1_2026') {
        fromDate = '2026-01-01';
        toDate = '2026-03-31';
      } else if (typeof from === 'string' && typeof to === 'string') {
        // Validated BEFORE reaching Postgres, which rejects a malformed date as
        // a type error that would otherwise surface as an indistinguishable 500.
        if (!isValidDate(from) || !isValidDate(to)) {
          res.status(400).json({ error: 'from and to must be ISO dates (YYYY-MM-DD)' });
          return;
        }
        fromDate = from;
        toDate = to;
      } else {
        res.status(400).json({ error: 'Specify from/to dates or period (q1_2025, q1_2026)' });
        return;
      }

      const weatherSummary = await weather.summaryForEfficiency(fromDate, toDate);
      const fillTotals = await fills.between(fromDate, toDate);

      let efficiency: number | null = null;
      if (fillTotals.totalLiters && weatherSummary.totalHdd) {
        efficiency = calculateEfficiency(fillTotals.totalLiters, weatherSummary.totalHdd);
      }

      res.json({
        period: { from: fromDate, to: toDate },
        weather: {
          days: weatherSummary.days,
          total_hdd: weatherSummary.totalHdd !== null ? round(weatherSummary.totalHdd, 1) : null,
          avg_hdd_per_day: weatherSummary.avgHdd !== null ? round(weatherSummary.avgHdd, 2) : null,
          avg_temp: weatherSummary.avgTemp !== null ? round(weatherSummary.avgTemp, 1) : null,
          min_temp: weatherSummary.minTemp,
          max_temp: weatherSummary.maxTemp,
        },
        fuel: {
          total_liters: fillTotals.totalLiters !== null ? round(fillTotals.totalLiters, 1) : null,
          total_cost: fillTotals.totalCost !== null ? round(fillTotals.totalCost, 2) : null,
          fill_count: fillTotals.count,
        },
        efficiency: {
          liters_per_hdd: efficiency !== null ? round(efficiency, 3) : null,
        },
      });
    }),
  );

  // Get cost analysis
  router.get(
    '/costs',
    asyncRoute(async (_req, res) => {
      const allFills = await fills.list();

      const totalLiters = allFills.reduce((sum, f) => sum + f.litersAdded, 0);
      const totalCost = allFills.reduce((sum, f) => sum + (f.totalCost ?? 0), 0);
      const avgPricePerLiter = totalLiters > 0 ? totalCost / totalLiters : 0;

      const totalHddAllTime = await weather.totalHddAllTime();

      // Guards against both absent and zero all-time HDD deliberately — see
      // the same guard in /current above.
      const costPerHDD = totalHddAllTime ? totalCost / totalHddAllTime : null;

      // Annual projections based on ~7200 HDD/year for Fort Smith
      const annualHDD = 7200;
      const efficiencies = [0.191, 0.35, 0.4, 0.45];

      const projections = efficiencies.map((eff) => {
        const annualLiters = annualHDD * eff;
        const annualCost = annualLiters * avgPricePerLiter;
        return {
          efficiency: eff,
          annual_liters: Math.round(annualLiters),
          annual_cost: round(annualCost, 2),
        };
      });

      res.json({
        totals: {
          liters: round(totalLiters, 1),
          cost: round(totalCost, 2),
          fills: allFills.length,
        },
        averages: {
          price_per_liter: round(avgPricePerLiter, 3),
          cost_per_hdd: costPerHDD !== null ? round(costPerHDD, 2) : null,
        },
        annual_projections: {
          assumed_annual_hdd: annualHDD,
          assumed_price_per_liter: round(avgPricePerLiter, 3),
          scenarios: projections,
        },
        recent_fills: allFills.slice(0, 5),
      });
    }),
  );

  return router;
}
