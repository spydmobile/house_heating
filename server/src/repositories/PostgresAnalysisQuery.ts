import type { QueryClient } from './QueryClient';
import type { GaugeReading } from './PostgresGaugeReadingRepository';
import type { FuelFill } from './PostgresFuelFillRepository';

/**
 * Read model backing the four /api/analysis routes (createAnalysisRouter.ts).
 *
 * Every method here exists because no entity repository — fills, weather,
 * readings — expresses the aggregate the old sqlite route (analysis.ts) built
 * inline. Kept together rather than bolted onto the entity repositories so
 * none of them quietly grows cross-concern knowledge of the others.
 *
 * SUM over zero rows is NULL in Postgres; COUNT is 0. Every aggregate here
 * keeps that distinction rather than coercing the null to 0 — a consumption
 * figure gets divided by these, and dividing by an invented zero is how a
 * comparison concludes the new windows made the house worse.
 */

export interface FillsAfterTotals {
  totalAdded: number | null;
  count: number;
}

export interface FillsBetweenTotals {
  totalLiters: number | null;
  totalCost: number | null;
  count: number;
}

export interface HddBetweenTotals {
  totalHdd: number | null;
  days: number;
}

export interface EfficiencyWeatherSummary {
  days: number;
  totalHdd: number | null;
  /**
   * AVG(hdd), not totalHdd/days — not the same number whenever a row in range
   * has a null hdd, since AVG excludes those rows from its own denominator
   * and days (COUNT(*)) does not.
   */
  avgHdd: number | null;
  avgTemp: number | null;
  minTemp: number | null;
  maxTemp: number | null;
}

interface GaugeReadingRow {
  id: number;
  client_uuid: string | null;
  date: string | Date;
  gauge_percent: number | string;
  notes: string | null;
  created_at: string | Date;
}

interface FuelFillRow {
  id: number;
  client_uuid: string | null;
  date: string | Date;
  gauge_percent_before: number | string;
  liters_added: string | number;
  liters_before_fill: string | number | null;
  price_per_liter: string | number;
  discount: string | number;
  gst: string | number | null;
  total_cost: string | number | null;
  notes: string | null;
  created_at: string | Date;
}

function toIsoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function toNumber(value: string | number): number;
function toNumber(value: string | number | null): number | null;
function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' ? value : Number(value);
}

function toGaugeReading(row: unknown): GaugeReading {
  const r = row as GaugeReadingRow;

  return {
    id: Number(r.id),
    clientUuid: r.client_uuid,
    date: toIsoDate(r.date),
    gaugePercent: toNumber(r.gauge_percent),
    notes: r.notes,
    createdAt:
      r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

function toFuelFill(row: unknown): FuelFill {
  const r = row as FuelFillRow;

  return {
    id: Number(r.id),
    clientUuid: r.client_uuid,
    date: toIsoDate(r.date),
    gaugePercentBefore: toNumber(r.gauge_percent_before),
    litersAdded: toNumber(r.liters_added),
    litersBeforeFill: toNumber(r.liters_before_fill),
    pricePerLiter: toNumber(r.price_per_liter),
    discount: toNumber(r.discount),
    gst: toNumber(r.gst),
    totalCost: toNumber(r.total_cost),
    notes: r.notes,
    createdAt:
      r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

const READING_COLUMNS = 'id, client_uuid, date, gauge_percent, notes, created_at';

const FILL_COLUMNS = `
  id, client_uuid, date, gauge_percent_before, liters_added, liters_before_fill,
  price_per_liter, discount, gst, total_cost, notes, created_at
`;

export class PostgresAnalysisQuery {
  constructor(private readonly client: QueryClient) {}

  async latestGaugeReading(): Promise<GaugeReading | null> {
    const result = await this.client.query(
      `SELECT ${READING_COLUMNS} FROM gauge_readings ORDER BY date DESC LIMIT 1;`,
    );

    return result.rows.length > 0 ? toGaugeReading(result.rows[0]) : null;
  }

  async latestFuelFill(): Promise<FuelFill | null> {
    const result = await this.client.query(
      `SELECT ${FILL_COLUMNS} FROM fuel_fills ORDER BY date DESC LIMIT 1;`,
    );

    return result.rows.length > 0 ? toFuelFill(result.rows[0]) : null;
  }

  /** Fills recorded strictly after `date` — used to add back fills that post-date a gauge reading. */
  async fillsAddedAfter(date: string): Promise<FillsAfterTotals> {
    const result = await this.client.query(
      `SELECT SUM(liters_added) AS total_added, COUNT(*) AS count FROM fuel_fills WHERE date > $1;`,
      [date],
    );

    const row = result.rows[0] as { total_added: string | number | null; count: string | number };

    return { totalAdded: toNumber(row.total_added), count: Number(row.count) };
  }

  /** Fills within an inclusive [from, to] range — matches `/efficiency`'s period filter. */
  async fillsBetweenInclusive(from: string, to: string): Promise<FillsBetweenTotals> {
    const result = await this.client.query(
      `
      SELECT SUM(liters_added) AS total_liters, SUM(total_cost) AS total_cost, COUNT(*) AS count
      FROM fuel_fills
      WHERE date >= $1 AND date <= $2;
      `,
      [from, to],
    );

    const row = result.rows[0] as {
      total_liters: string | number | null;
      total_cost: string | number | null;
      count: string | number;
    };

    return {
      totalLiters: toNumber(row.total_liters),
      totalCost: toNumber(row.total_cost),
      count: Number(row.count),
    };
  }

  /**
   * Degree days between two dates, exclusive of `from`, inclusive of `to` —
   * matches the original route's `date > ? AND date <= ?` exactly, so two
   * adjacent periods never double-count the boundary day.
   */
  async hddBetweenExclusive(from: string, to: string): Promise<HddBetweenTotals> {
    const result = await this.client.query(
      `SELECT SUM(hdd) AS total_hdd, COUNT(*) AS days FROM weather_data WHERE date > $1 AND date <= $2;`,
      [from, to],
    );

    const row = result.rows[0] as { total_hdd: string | number | null; days: string | number };

    return { totalHdd: toNumber(row.total_hdd), days: Number(row.days) };
  }

  /** All-time total HDD, with no date bound at all — used by `/costs`. */
  async totalHddAllTime(): Promise<number | null> {
    const result = await this.client.query(`SELECT SUM(hdd) AS total_hdd FROM weather_data;`);

    const row = result.rows[0] as { total_hdd: string | number | null };

    return toNumber(row.total_hdd);
  }

  /** Full weather aggregate for `/efficiency`, including AVG(hdd) — see EfficiencyWeatherSummary. */
  async weatherSummaryForEfficiency(from: string, to: string): Promise<EfficiencyWeatherSummary> {
    const result = await this.client.query(
      `
      SELECT
        COUNT(*)       AS days,
        SUM(hdd)       AS total_hdd,
        AVG(hdd)       AS avg_hdd,
        AVG(mean_temp) AS avg_temp,
        MIN(min_temp)  AS min_temp,
        MAX(max_temp)  AS max_temp
      FROM weather_data
      WHERE date >= $1 AND date <= $2;
      `,
      [from, to],
    );

    const row = result.rows[0] as {
      days: string | number;
      total_hdd: string | number | null;
      avg_hdd: string | number | null;
      avg_temp: string | number | null;
      min_temp: string | number | null;
      max_temp: string | number | null;
    };

    return {
      days: Number(row.days),
      totalHdd: toNumber(row.total_hdd),
      avgHdd: toNumber(row.avg_hdd),
      avgTemp: toNumber(row.avg_temp),
      minTemp: toNumber(row.min_temp),
      maxTemp: toNumber(row.max_temp),
    };
  }
}
