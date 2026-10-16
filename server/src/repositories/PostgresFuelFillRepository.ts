import type { QueryClient } from './QueryClient';

/**
 * Postgres adapter for fuel fills.
 *
 * Two things here are load-bearing rather than incidental:
 *
 * 1. `save` UPSERTs on `client_uuid`. The PWA's offline queue retries as its
 *    NORMAL path — a fill is accepted at the tank with no network and flushed
 *    later — so a plain INSERT would duplicate fills on any retry. The project
 *    exists to compute the window-replacement ROI from this history, so a
 *    duplicate fill corrupts the deliverable rather than merely the table.
 *
 * 2. NUMERIC columns come back from `pg` as STRINGS, deliberately, because a
 *    NUMERIC can exceed what a JS number holds exactly. They are converted here
 *    once, at the boundary. Left alone, `litersAdded + x` would concatenate
 *    instead of adding and nothing would report it.
 */

export interface FuelFill {
  id: number;
  clientUuid: string | null;
  date: string;
  gaugePercentBefore: number;
  litersAdded: number;
  litersBeforeFill: number | null;
  pricePerLiter: number;
  discount: number;
  gst: number | null;
  totalCost: number | null;
  notes: string | null;
  createdAt: string;
}

export interface NewFuelFill {
  clientUuid?: string | null;
  date: string;
  gaugePercentBefore: number;
  litersAdded: number;
  litersBeforeFill: number | null;
  pricePerLiter: number;
  discount: number;
  gst: number | null;
  totalCost: number | null;
  notes: string | null;
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

/** NUMERIC arrives as a string. Null stays null — it is not zero. */
function toNumber(value: string | number): number;
function toNumber(value: string | number | null): number | null;
function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' ? value : Number(value);
}

function toIsoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function toRow(row: unknown): FuelFill {
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

const COLUMNS = `
  id, client_uuid, date, gauge_percent_before, liters_added, liters_before_fill,
  price_per_liter, discount, gst, total_cost, notes, created_at
`;

export class PostgresFuelFillRepository {
  constructor(private readonly client: QueryClient) {}

  async list(): Promise<FuelFill[]> {
    const result = await this.client.query(
      `SELECT ${COLUMNS} FROM fuel_fills ORDER BY date DESC;`,
    );

    return result.rows.map(toRow);
  }

  async findById(id: number): Promise<FuelFill | null> {
    const result = await this.client.query(
      `SELECT ${COLUMNS} FROM fuel_fills WHERE id = $1;`,
      [id],
    );

    // Null, not undefined: an absent row is a value the caller must handle.
    return result.rows.length > 0 ? toRow(result.rows[0]) : null;
  }

  /**
   * Idempotent on `client_uuid`. DO UPDATE rather than DO NOTHING so the row is
   * always RETURNED — DO NOTHING returns no row on conflict, which would make a
   * retry look like a failure to the client and send it round again.
   */
  async save(fill: NewFuelFill): Promise<FuelFill> {
    const result = await this.client.query(
      `
      INSERT INTO fuel_fills (
        client_uuid, date, gauge_percent_before, liters_added, liters_before_fill,
        price_per_liter, discount, gst, total_cost, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (client_uuid) DO UPDATE SET
        date                 = EXCLUDED.date,
        gauge_percent_before = EXCLUDED.gauge_percent_before,
        liters_added         = EXCLUDED.liters_added,
        liters_before_fill   = EXCLUDED.liters_before_fill,
        price_per_liter      = EXCLUDED.price_per_liter,
        discount             = EXCLUDED.discount,
        gst                  = EXCLUDED.gst,
        total_cost           = EXCLUDED.total_cost,
        notes                = EXCLUDED.notes
      RETURNING ${COLUMNS};
      `,
      [
        fill.clientUuid ?? null,
        fill.date,
        fill.gaugePercentBefore,
        fill.litersAdded,
        fill.litersBeforeFill,
        fill.pricePerLiter,
        fill.discount,
        fill.gst,
        fill.totalCost,
        fill.notes,
      ],
    );

    if (result.rows.length === 0) {
      throw new Error(
        'Saving a fuel fill returned no row. The INSERT reported success ' +
          'without producing a record, which must not be treated as a save.',
      );
    }

    return toRow(result.rows[0]);
  }

  async deleteById(id: number): Promise<boolean> {
    const result = await this.client.query(
      'DELETE FROM fuel_fills WHERE id = $1 RETURNING id;',
      [id],
    );

    return result.rows.length > 0;
  }
}
