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

export interface WeatherSummary {
  /** null means no data for the range — never 0, which would be a reading. */
  avgMeanTemp: number | null;
  minTemp: number | null;
  maxTemp: number | null;
  totalHdd: number | null;
  /** How many days back the aggregates. 0 means they are all null. */
  dayCount: number;
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

  /** Every recorded day, newest first. */
  async list(): Promise<WeatherDay[]> {
    const result = await this.client.query(
      `SELECT ${COLUMNS} FROM weather_data ORDER BY date DESC;`,
    );

    return result.rows.map(toRow);
  }

  /**
   * Days in an optionally-bounded range, newest first.
   *
   * The client's `getWeather(from?, to?)` may send either bound, both, or
   * neither — Dashboard.tsx calls it with none — so all four shapes are valid
   * requests rather than errors.
   *
   * The old sqlite route built this by concatenating clause text onto a query
   * string. The clauses are assembled here too, but every BOUND is a bound
   * parameter, so a date can never become part of the SQL text regardless of
   * what arrives in the query string.
   */
  async findRange(
    from: string | null,
    to: string | null,
  ): Promise<WeatherDay[]> {
    const clauses: string[] = [];
    const params: string[] = [];

    if (from !== null) {
      params.push(from);
      clauses.push(`date >= $${params.length}`);
    }

    if (to !== null) {
      params.push(to);
      clauses.push(`date <= $${params.length}`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const result = await this.client.query(
      `SELECT ${COLUMNS} FROM weather_data ${where} ORDER BY date DESC;`,
      params,
    );

    return result.rows.map(toRow);
  }

  /**
   * Degree days BETWEEN two gauge readings: exclusive of the earlier day,
   * inclusive of the later one. Without the exclusive bound the boundary day is
   * counted in both of two adjacent periods.
   *
   * Returns NULL for a period with no weather rows — deliberately unlike
   * `totalHdd`, which returns 0 for an empty range. The caller divides a
   * consumption figure by this, and dividing by an invented zero is precisely
   * how a comparison concludes the new windows made the house worse. COUNT is
   * selected alongside SUM because SUM alone cannot distinguish "no rows" from
   * "rows that sum to zero".
   */
  async hddForPeriod(from: string, to: string): Promise<number | null> {
    const result = await this.client.query(
      `
      SELECT SUM(hdd) AS total, COUNT(*) AS count
      FROM weather_data
      WHERE date > $1 AND date <= $2;
      `,
      [from, to],
    );

    const { total, count } = result.rows[0] as {
      total: string | number | null;
      count: string | number;
    };

    if (Number(count) === 0) return null;

    return total === null ? null : Number(total);
  }

  /**
   * Temperature aggregates for a range, with the day count that backs them.
   *
   * Every aggregate is null for an empty range rather than 0. An average of
   * 0 °C is entirely plausible in Fort Smith, so a fabricated zero here would
   * read as a measurement and not as missing data.
   */
  async summary(from: string, to: string): Promise<WeatherSummary> {
    const result = await this.client.query(
      `
      SELECT
        AVG(mean_temp) AS avg_mean_temp,
        MIN(min_temp)  AS min_temp,
        MAX(max_temp)  AS max_temp,
        SUM(hdd)       AS total_hdd,
        COUNT(*)       AS day_count
      FROM weather_data
      WHERE date BETWEEN $1 AND $2;
      `,
      [from, to],
    );

    const row = result.rows[0] as {
      avg_mean_temp: string | number | null;
      min_temp: string | number | null;
      max_temp: string | number | null;
      total_hdd: string | number | null;
      day_count: string | number;
    };

    return {
      avgMeanTemp: toNullableNumber(row.avg_mean_temp),
      minTemp: toNullableNumber(row.min_temp),
      maxTemp: toNullableNumber(row.max_temp),
      totalHdd: toNullableNumber(row.total_hdd),
      dayCount: Number(row.day_count),
    };
  }

  /** True only if a row was actually removed. */
  async deleteByDate(date: string): Promise<boolean> {
    const result = await this.client.query(
      'DELETE FROM weather_data WHERE date = $1 RETURNING date;',
      [date],
    );

    return result.rows.length > 0;
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
