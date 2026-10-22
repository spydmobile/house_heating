"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresMonthlyEfficiencyQuery = void 0;
function toNullableNumber(value) {
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
class PostgresMonthlyEfficiencyQuery {
    client;
    constructor(client) {
        this.client = client;
    }
    async list() {
        const result = await this.client.query(SQL);
        return result.rows.map((row) => {
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
                // SUM over NUMERIC arrives as a string; SUM over no rows arrives as
                // NULL. Null stays null — "nothing recorded" is not "zero".
                fuelLiters: toNullableNumber(r.fuel_liters),
                totalHdd: toNullableNumber(r.total_hdd),
                weatherDays: Number(r.weather_days),
            };
        });
    }
}
exports.PostgresMonthlyEfficiencyQuery = PostgresMonthlyEfficiencyQuery;
