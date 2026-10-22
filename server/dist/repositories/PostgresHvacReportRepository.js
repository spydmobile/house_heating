"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresHvacReportRepository = void 0;
function toNullableNumber(value) {
    return value === null ? null : Number(value);
}
function toRow(row) {
    const r = row;
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
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    };
}
const COLUMNS = `
  id, year, month, total_runtime_hours, avg_cycle_minutes, avg_outdoor_temp,
  avg_indoor_temp, avg_setpoint, notes, created_at
`;
class PostgresHvacReportRepository {
    client;
    constructor(client) {
        this.client = client;
    }
    async list() {
        const result = await this.client.query(`SELECT ${COLUMNS} FROM hvac_reports ORDER BY year, month;`);
        return result.rows.map(toRow);
    }
    async findByMonth(year, month) {
        const result = await this.client.query(`SELECT ${COLUMNS} FROM hvac_reports WHERE year = $1 AND month = $2;`, [year, month]);
        return result.rows.length > 0 ? toRow(result.rows[0]) : null;
    }
    /** True only if a report was actually removed, so the caller can 404. */
    async deleteByMonth(year, month) {
        const result = await this.client.query('DELETE FROM hvac_reports WHERE year = $1 AND month = $2 RETURNING id;', [year, month]);
        return result.rows.length > 0;
    }
    async save(report) {
        const result = await this.client.query(`
      INSERT INTO hvac_reports (
        year, month, total_runtime_hours, avg_cycle_minutes, avg_outdoor_temp,
        avg_indoor_temp, avg_setpoint, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (year, month) DO UPDATE SET
        total_runtime_hours = EXCLUDED.total_runtime_hours,
        avg_cycle_minutes   = EXCLUDED.avg_cycle_minutes,
        avg_outdoor_temp    = EXCLUDED.avg_outdoor_temp,
        avg_indoor_temp     = EXCLUDED.avg_indoor_temp,
        avg_setpoint        = EXCLUDED.avg_setpoint,
        notes               = EXCLUDED.notes
      RETURNING ${COLUMNS};
      `, [
            report.year,
            report.month,
            report.totalRuntimeHours,
            report.avgCycleMinutes,
            report.avgOutdoorTemp,
            report.avgIndoorTemp,
            report.avgSetpoint,
            report.notes,
        ]);
        if (result.rows.length === 0) {
            throw new Error(`Saving the HVAC report for ${report.year}-${report.month} returned no ` +
                'row. The INSERT reported success without producing a record, which ' +
                'must not be treated as a save.');
        }
        return toRow(result.rows[0]);
    }
}
exports.PostgresHvacReportRepository = PostgresHvacReportRepository;
