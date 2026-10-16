import type { QueryClient } from './QueryClient';

/**
 * Postgres adapter for daily weather.
 *
 * No `client_uuid` here, deliberately: weather is written by the server from
 * Environment Canada, never queued on a phone. Its natural key is the date —
 * one row per day — and the sync re-fetches overlapping ranges, so `save`
 * upserts on date.
 *
 * `countDays` exists because an HDD total is uninterpretable without it. Six
 * days of January cannot carry a quarterly total, and a caller handed only the
 * sum cannot tell a complete quarter from a nearly empty one. A day genuinely
 * absent from every Fort Smith station stays absent — nothing here interpolates.
 */

export interface WeatherDay {
  id: number;
  date: string;
  maxTemp: number | null;
  minTemp: number | null;
  meanTemp: number | null;
  hdd: number | null;
  source: string;
  createdAt: string;
}

export interface NewWeatherDay {
  date: string;
  maxTemp: number | null;
  minTemp: number | null;
  meanTemp: number | null;
  hdd: number | null;
  source: string;
}

interface WeatherRow {
  id: number;
  date: string | Date;
  max_temp: number | null;
  min_temp: number | null;
  mean_temp: number | null;
  hdd: number | null;
  source: string;
  created_at: string | Date;
}

function toNullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function toRow(row: unknown): WeatherDay {
  const r = row as WeatherRow;

  return {
    id: Number(r.id),
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date,
    maxTemp: toNullableNumber(r.max_temp),
    minTemp: toNullableNumber(r.min_temp),
    meanTemp: toNullableNumber(r.mean_temp),
    hdd: toNullableNumber(r.hdd),
    source: r.source,
    createdAt:
      r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

const COLUMNS =
  'id, date, max_temp, min_temp, mean_temp, hdd, source, created_at';

export class PostgresWeatherRepository {
  constructor(private readonly client: QueryClient) {}

  async findBetween(from: string, to: string): Promise<WeatherDay[]> {
    const result = await this.client.query(
      `SELECT ${COLUMNS} FROM weather_data WHERE date BETWEEN $1 AND $2 ORDER BY date;`,
      [from, to],
    );

    return result.rows.map(toRow);
  }

  /** 0 for an empty range, never null — SUM over no rows is NULL in SQL. */
  async totalHdd(from: string, to: string): Promise<number> {
    const result = await this.client.query(
      'SELECT SUM(hdd) AS total FROM weather_data WHERE date BETWEEN $1 AND $2;',
      [from, to],
    );

    const { total } = result.rows[0] as { total: string | number | null };

    return total === null ? 0 : Number(total);
  }

  /**
   * How many days the range actually HAS. Read this with `totalHdd` — the sum
   * alone cannot distinguish a complete quarter from a sparse one.
   */
  async countDays(from: string, to: string): Promise<number> {
    const result = await this.client.query(
      'SELECT COUNT(*) AS count FROM weather_data WHERE date BETWEEN $1 AND $2;',
      [from, to],
    );

    const { count } = result.rows[0] as { count: string | number };

    return Number(count);
  }

  async save(day: NewWeatherDay): Promise<WeatherDay> {
    const result = await this.client.query(
      `
      INSERT INTO weather_data (date, max_temp, min_temp, mean_temp, hdd, source)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (date) DO UPDATE SET
        max_temp  = EXCLUDED.max_temp,
        min_temp  = EXCLUDED.min_temp,
        mean_temp = EXCLUDED.mean_temp,
        hdd       = EXCLUDED.hdd,
        source    = EXCLUDED.source
      RETURNING ${COLUMNS};
      `,
      [day.date, day.maxTemp, day.minTemp, day.meanTemp, day.hdd, day.source],
    );

    if (result.rows.length === 0) {
      throw new Error(
        `Saving weather for ${day.date} returned no row. The INSERT reported ` +
          'success without producing a record, which must not be treated as a save.',
      );
    }

    return toRow(result.rows[0]);
  }
}
