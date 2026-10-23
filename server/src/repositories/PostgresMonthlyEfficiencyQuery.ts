import type { QueryClient } from './QueryClient';

/**
 * Monthly efficiency read model: each HVAC report with the fuel burned and the
 * heating degree days for that month.
 *
 * A READ MODEL, not an entity repository — it spans three tables and belongs to
 * no single one of them. Keeping it separate stops the HVAC repository from
 * quietly growing knowledge of fuel and weather.
 *
 * Replaces the SQLite original at routes/hvac.ts:142-154, which correlated the
 * tables with `strftime('%Y', date) = CAST(h.year AS TEXT)`. `strftime` does not
 * exist in Postgres; `EXTRACT(YEAR FROM date)` does, and it returns a number so
 * the CASTs disappear with it.
 *
 * `weatherDays` is not in the original and is the point of rewriting rather than
 * translating. An HDD total of 188.2 from six days of January and one from
 * thirty-one days look identical to a caller, and dividing fuel by the first one
 * is how a comparison concludes the new windows made the house worse. The count
 * travels with the total so a caller cannot fail to see it.
 */

export interface MonthlyEfficiencyRow {
  id: number;
  year: number;
  month: number;
  totalRuntimeHours: number;
  avgCycleMinutes: number | null;
  avgOutdoorTemp: number | null;
  avgIndoorTemp: number | null;
  avgSetpoint: number | null;
  notes: string | null;
  createdAt: string;
  /** null means no fuel RECORDED that month — not zero litres burned. */
  fuelLiters: number | null;
  /** null means no weather recorded — read it with `weatherDays`. */
  totalHdd: number | null;
  /** How many days of weather back `totalHdd`. 0 means the total is empty. */
  weatherDays: number;
}

interface EfficiencyRow {
  id: number | string;
  year: number | string;
  month: number | string;
  total_runtime_hours: number | string;
  avg_cycle_minutes: number | string | null;
  avg_outdoor_temp: number | string | null;
  avg_indoor_temp: number | string | null;
  avg_setpoint: number | string | null;
  notes: string | null;
  created_at: string | Date;
  fuel_liters: number | string | null;
  total_hdd: number | string | null;
  weather_days: number | string;
}

function toNullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

const SQL = `
  SELECT
    h.id,
    h.year,
    h.month,
    h.total_runtime_hours,
    h.avg_cycle_minutes,
    h.avg_outdoor_temp,
    h.avg_indoor_temp,
    h.avg_setpoint,
    h.notes,
    h.created_at,
    (
      SELECT SUM(f.liters_added)
      FROM fuel_fills f
      WHERE EXTRACT(YEAR  FROM f.date) = h.year
        AND EXTRACT(MONTH FROM f.date) = h.month
    ) AS fuel_liters,
    (
      SELECT SUM(w.hdd)
      FROM weather_data w
      WHERE EXTRACT(YEAR  FROM w.date) = h.year
        AND EXTRACT(MONTH FROM w.date) = h.month
    ) AS total_hdd,
    (
      SELECT COUNT(*)
      FROM weather_data w
      WHERE EXTRACT(YEAR  FROM w.date) = h.year
        AND EXTRACT(MONTH FROM w.date) = h.month
    ) AS weather_days
  FROM hvac_reports h
  ORDER BY h.year, h.month;
`;

export class PostgresMonthlyEfficiencyQuery {
  constructor(private readonly client: QueryClient) {}

  async list(): Promise<MonthlyEfficiencyRow[]> {
    const result = await this.client.query(SQL);

    return result.rows.map((row) => {
      const r = row as EfficiencyRow;

      return {
        id: Number(r.id),
        year: Number(r.year),
        month: Number(r.month),
        totalRuntimeHours: Number(r.total_runtime_hours),
        avgCycleMinutes: toNullableNumber(r.avg_cycle_minutes),
        avgOutdoorTemp: toNullableNumber(r.avg_outdoor_temp),
        avgIndoorTemp: toNullableNumber(r.avg_indoor_temp),
        avgSetpoint: toNullableNumber(r.avg_setpoint),
        notes: r.notes,
        createdAt:
          r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        // SUM over NUMERIC arrives as a string; SUM over no rows arrives as
        // NULL. Null stays null — "nothing recorded" is not "zero".
        fuelLiters: toNullableNumber(r.fuel_liters),
        totalHdd: toNullableNumber(r.total_hdd),
        weatherDays: Number(r.weather_days),
      };
    });
  }
}
