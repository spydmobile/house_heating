"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresAnalysisQuery = void 0;
function toIsoDate(value) {
    return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}
function toNumber(value) {
    if (value === null)
        return null;
    return typeof value === 'number' ? value : Number(value);
}
function toGaugeReading(row) {
    const r = row;
    return {
        id: Number(r.id),
        clientUuid: r.client_uuid,
        date: toIsoDate(r.date),
        gaugePercent: toNumber(r.gauge_percent),
        notes: r.notes,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    };
}
function toFuelFill(row) {
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
const READING_COLUMNS = 'id, client_uuid, date, gauge_percent, notes, created_at';
const FILL_COLUMNS = `
  id, client_uuid, date, gauge_percent_before, liters_added, liters_before_fill,
  price_per_liter, discount, gst, total_cost, notes, created_at
`;
class PostgresAnalysisQuery {
    client;
    constructor(client) {
        this.client = client;
    }
    async latestGaugeReading() {
        const result = await this.client.query(`SELECT ${READING_COLUMNS} FROM gauge_readings ORDER BY date DESC LIMIT 1;`);
        return result.rows.length > 0 ? toGaugeReading(result.rows[0]) : null;
    }
    async latestFuelFill() {
        const result = await this.client.query(`SELECT ${FILL_COLUMNS} FROM fuel_fills ORDER BY date DESC LIMIT 1;`);
        return result.rows.length > 0 ? toFuelFill(result.rows[0]) : null;
    }
    /** Fills recorded strictly after `date` — used to add back fills that post-date a gauge reading. */
    async fillsAddedAfter(date) {
        const result = await this.client.query(`SELECT SUM(liters_added) AS total_added, COUNT(*) AS count FROM fuel_fills WHERE date > $1;`, [date]);
        const row = result.rows[0];
        return { totalAdded: toNumber(row.total_added), count: Number(row.count) };
    }
    /** Fills within an inclusive [from, to] range — matches `/efficiency`'s period filter. */
    async fillsBetweenInclusive(from, to) {
        const result = await this.client.query(`
      SELECT SUM(liters_added) AS total_liters, SUM(total_cost) AS total_cost, COUNT(*) AS count
      FROM fuel_fills
      WHERE date >= $1 AND date <= $2;
      `, [from, to]);
        const row = result.rows[0];
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
    async hddBetweenExclusive(from, to) {
        const result = await this.client.query(`SELECT SUM(hdd) AS total_hdd, COUNT(*) AS days FROM weather_data WHERE date > $1 AND date <= $2;`, [from, to]);
        const row = result.rows[0];
        return { totalHdd: toNumber(row.total_hdd), days: Number(row.days) };
    }
    /** All-time total HDD, with no date bound at all — used by `/costs`. */
    async totalHddAllTime() {
        const result = await this.client.query(`SELECT SUM(hdd) AS total_hdd FROM weather_data;`);
        const row = result.rows[0];
        return toNumber(row.total_hdd);
    }
    /** Full weather aggregate for `/efficiency`, including AVG(hdd) — see EfficiencyWeatherSummary. */
    async weatherSummaryForEfficiency(from, to) {
        const result = await this.client.query(`
      SELECT
        COUNT(*)       AS days,
        SUM(hdd)       AS total_hdd,
        AVG(hdd)       AS avg_hdd,
        AVG(mean_temp) AS avg_temp,
        MIN(min_temp)  AS min_temp,
        MAX(max_temp)  AS max_temp
      FROM weather_data
      WHERE date >= $1 AND date <= $2;
      `, [from, to]);
        const row = result.rows[0];
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
exports.PostgresAnalysisQuery = PostgresAnalysisQuery;
