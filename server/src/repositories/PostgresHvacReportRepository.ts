import type { QueryClient } from './QueryClient';

/**
 * Postgres adapter for monthly HVAC reports.
 *
 * Natural key is (year, month) — one report per month, re-imported when a
 * corrected thermostat export arrives, so `save` upserts on the composite key.
 *
 * This repository stores what the report says and does not judge it. The
 * 2024-25 rows are known to contradict themselves — 2025-03 is 4.5 °C warmer
 * than 2025-01 yet shows 2.7x the runtime — and they are the baseline side of
 * the window-ROI comparison. Deciding whether a month is credible is a use-case
 * concern, not the adapter's: a repository that silently dropped implausible
 * rows would hide the very problem that needs auditing.
 */

export interface HvacReport {
  id: number;
  year: number;
  month: number;
  totalRuntimeHours: number;
  avgCycleMinutes: number | null;
  avgOutdoorTemp: number | null;
  avgIndoorTemp: number | null;
  avgSetpoint: number | null;
  notes: string | null;
  createdAt: string;
}

export interface NewHvacReport {
  year: number;
  month: number;
  totalRuntimeHours: number;
  avgCycleMinutes: number | null;
  avgOutdoorTemp: number | null;
  avgIndoorTemp: number | null;
  avgSetpoint: number | null;
  notes: string | null;
}

interface HvacReportRow {
  id: number;
  year: number | string;
  month: number | string;
  total_runtime_hours: number | string;
  avg_cycle_minutes: number | string | null;
  avg_outdoor_temp: number | string | null;
  avg_indoor_temp: number | string | null;
  avg_setpoint: number | string | null;
  notes: string | null;
  created_at: string | Date;
}

function toNullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function toRow(row: unknown): HvacReport {
  const r = row as HvacReportRow;

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
    createdAt:
      r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

const COLUMNS = `
  id, year, month, total_runtime_hours, avg_cycle_minutes, avg_outdoor_temp,
  avg_indoor_temp, avg_setpoint, notes, created_at
`;

export class PostgresHvacReportRepository {
  constructor(private readonly client: QueryClient) {}

  async list(): Promise<HvacReport[]> {
    const result = await this.client.query(
      `SELECT ${COLUMNS} FROM hvac_reports ORDER BY year, month;`,
    );

    return result.rows.map(toRow);
  }

  async findByMonth(year: number, month: number): Promise<HvacReport | null> {
    const result = await this.client.query(
      `SELECT ${COLUMNS} FROM hvac_reports WHERE year = $1 AND month = $2;`,
      [year, month],
    );

    return result.rows.length > 0 ? toRow(result.rows[0]) : null;
  }

  async save(report: NewHvacReport): Promise<HvacReport> {
    const result = await this.client.query(
      `
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
      `,
      [
        report.year,
        report.month,
        report.totalRuntimeHours,
        report.avgCycleMinutes,
        report.avgOutdoorTemp,
        report.avgIndoorTemp,
        report.avgSetpoint,
        report.notes,
      ],
    );

    if (result.rows.length === 0) {
      throw new Error(
        `Saving the HVAC report for ${report.year}-${report.month} returned no ` +
          'row. The INSERT reported success without producing a record, which ' +
          'must not be treated as a save.',
      );
    }

    return toRow(result.rows[0]);
  }
}
