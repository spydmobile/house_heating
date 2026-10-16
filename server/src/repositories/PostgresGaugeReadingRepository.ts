import type { QueryClient } from './QueryClient';

/**
 * Postgres adapter for gauge readings.
 *
 * Same shape and same reasoning as the fills repository: a reading is taken at
 * the tank with no network, queued, and flushed later, so `save` is idempotent
 * on `client_uuid` and a retry updates rather than duplicating.
 *
 * `gauge_percent` is DOUBLE PRECISION rather than NUMERIC — it is a measurement
 * off a float gauge, not currency — so it needs no string conversion. Said
 * explicitly because the fills repository DOES need it, and the difference
 * between the two files is deliberate rather than an oversight.
 */

export interface GaugeReading {
  id: number;
  clientUuid: string | null;
  date: string;
  gaugePercent: number;
  notes: string | null;
  createdAt: string;
}

export interface NewGaugeReading {
  clientUuid?: string | null;
  date: string;
  gaugePercent: number;
  notes: string | null;
}

interface GaugeReadingRow {
  id: number;
  client_uuid: string | null;
  date: string | Date;
  gauge_percent: number | string;
  notes: string | null;
  created_at: string | Date;
}

function toRow(row: unknown): GaugeReading {
  const r = row as GaugeReadingRow;

  return {
    id: Number(r.id),
    clientUuid: r.client_uuid,
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date,
    gaugePercent: Number(r.gauge_percent),
    notes: r.notes,
    createdAt:
      r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

const COLUMNS = 'id, client_uuid, date, gauge_percent, notes, created_at';

export class PostgresGaugeReadingRepository {
  constructor(private readonly client: QueryClient) {}

  async list(): Promise<GaugeReading[]> {
    const result = await this.client.query(
      `SELECT ${COLUMNS} FROM gauge_readings ORDER BY date DESC;`,
    );

    return result.rows.map(toRow);
  }

  async findById(id: number): Promise<GaugeReading | null> {
    const result = await this.client.query(
      `SELECT ${COLUMNS} FROM gauge_readings WHERE id = $1;`,
      [id],
    );

    return result.rows.length > 0 ? toRow(result.rows[0]) : null;
  }

  async save(reading: NewGaugeReading): Promise<GaugeReading> {
    const result = await this.client.query(
      `
      INSERT INTO gauge_readings (client_uuid, date, gauge_percent, notes)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (client_uuid) DO UPDATE SET
        date          = EXCLUDED.date,
        gauge_percent = EXCLUDED.gauge_percent,
        notes         = EXCLUDED.notes
      RETURNING ${COLUMNS};
      `,
      [reading.clientUuid ?? null, reading.date, reading.gaugePercent, reading.notes],
    );

    if (result.rows.length === 0) {
      throw new Error(
        'Saving a gauge reading returned no row. The INSERT reported success ' +
          'without producing a record, which must not be treated as a save.',
      );
    }

    return toRow(result.rows[0]);
  }

  async deleteById(id: number): Promise<boolean> {
    const result = await this.client.query(
      'DELETE FROM gauge_readings WHERE id = $1 RETURNING id;',
      [id],
    );

    return result.rows.length > 0;
  }
}
