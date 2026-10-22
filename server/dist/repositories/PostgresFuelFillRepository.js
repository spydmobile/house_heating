"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresFuelFillRepository = void 0;
function toNumber(value) {
    if (value === null)
        return null;
    return typeof value === 'number' ? value : Number(value);
}
function toIsoDate(value) {
    return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}
function toRow(row) {
    const r = row;
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
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    };
}
const COLUMNS = `
  id, client_uuid, date, gauge_percent_before, liters_added, liters_before_fill,
  price_per_liter, discount, gst, total_cost, notes, created_at
`;
class PostgresFuelFillRepository {
    client;
    constructor(client) {
        this.client = client;
    }
    async list() {
        const result = await this.client.query(`SELECT ${COLUMNS} FROM fuel_fills ORDER BY date DESC;`);
        return result.rows.map(toRow);
    }
    async findById(id) {
        const result = await this.client.query(`SELECT ${COLUMNS} FROM fuel_fills WHERE id = $1;`, [id]);
        // Null, not undefined: an absent row is a value the caller must handle.
        return result.rows.length > 0 ? toRow(result.rows[0]) : null;
    }
    /**
     * Idempotent on `client_uuid`. DO UPDATE rather than DO NOTHING so the row is
     * always RETURNED — DO NOTHING returns no row on conflict, which would make a
     * retry look like a failure to the client and send it round again.
     */
    async save(fill) {
        const result = await this.client.query(`
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
      `, [
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
        ]);
        if (result.rows.length === 0) {
            throw new Error('Saving a fuel fill returned no row. The INSERT reported success ' +
                'without producing a record, which must not be treated as a save.');
        }
        return toRow(result.rows[0]);
    }
    async deleteById(id) {
        const result = await this.client.query('DELETE FROM fuel_fills WHERE id = $1 RETURNING id;', [id]);
        return result.rows.length > 0;
    }
}
exports.PostgresFuelFillRepository = PostgresFuelFillRepository;
