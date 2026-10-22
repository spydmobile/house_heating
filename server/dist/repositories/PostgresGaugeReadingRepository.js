"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresGaugeReadingRepository = void 0;
function toRow(row) {
    const r = row;
    return {
        id: Number(r.id),
        clientUuid: r.client_uuid,
        date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date,
        gaugePercent: Number(r.gauge_percent),
        notes: r.notes,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    };
}
const COLUMNS = 'id, client_uuid, date, gauge_percent, notes, created_at';
class PostgresGaugeReadingRepository {
    client;
    constructor(client) {
        this.client = client;
    }
    async list() {
        const result = await this.client.query(`SELECT ${COLUMNS} FROM gauge_readings ORDER BY date DESC;`);
        return result.rows.map(toRow);
    }
    async findById(id) {
        const result = await this.client.query(`SELECT ${COLUMNS} FROM gauge_readings WHERE id = $1;`, [id]);
        return result.rows.length > 0 ? toRow(result.rows[0]) : null;
    }
    async save(reading) {
        const result = await this.client.query(`
      INSERT INTO gauge_readings (client_uuid, date, gauge_percent, notes)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (client_uuid) DO UPDATE SET
        date          = EXCLUDED.date,
        gauge_percent = EXCLUDED.gauge_percent,
        notes         = EXCLUDED.notes
      RETURNING ${COLUMNS};
      `, [reading.clientUuid ?? null, reading.date, reading.gaugePercent, reading.notes]);
        if (result.rows.length === 0) {
            throw new Error('Saving a gauge reading returned no row. The INSERT reported success ' +
                'without producing a record, which must not be treated as a save.');
        }
        return toRow(result.rows[0]);
    }
    /**
     * Edits an existing reading by id — correcting a reading already stored.
     *
     * Deliberately NOT expressed as `save`'s upsert. `save` keys on
     * `client_uuid`, which is the offline-submission identity; readings imported
     * from the old SQLite database have a NULL client_uuid, and upserting those
     * would have every one of them collide on the same key.
     *
     * `client_uuid` is never written here: it identifies the original submission,
     * and rewriting it would detach the row from the queued item that created it.
     *
     * Returns null when no row has that id, so the caller can 404 rather than
     * report a success that changed nothing.
     */
    async update(id, edit) {
        const result = await this.client.query(`
      UPDATE gauge_readings
      SET date = $1, gauge_percent = $2, notes = $3
      WHERE id = $4
      RETURNING ${COLUMNS};
      `, [edit.date, edit.gaugePercent, edit.notes, id]);
        return result.rows.length > 0 ? toRow(result.rows[0]) : null;
    }
    async deleteById(id) {
        const result = await this.client.query('DELETE FROM gauge_readings WHERE id = $1 RETURNING id;', [id]);
        return result.rows.length > 0;
    }
}
exports.PostgresGaugeReadingRepository = PostgresGaugeReadingRepository;
