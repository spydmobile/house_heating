/**
 * Transforms rows from the legacy SQLite database into the shape the Postgres
 * repositories expect.
 *
 * This runs ONCE, against the only copy of the data the project exists to
 * analyse. The rules are therefore conservative on purpose:
 *
 * - A row that cannot be transformed THROWS, naming the table and id. It is
 *   never dropped and never coerced — a missing fuel fill would quietly change
 *   the window-replacement measurement, and a silent drop is indistinguishable
 *   from a row that never existed.
 * - Implausible values are carried across UNCHANGED. Repairing data during a
 *   migration invents history. The 2026-02-24 fill is known to be wrong; that
 *   is an audit someone should do deliberately and visibly, not a side effect
 *   of an import.
 * - Original ids are PRESERVED, which makes a re-run idempotent via
 *   ON CONFLICT (id) rather than appending the whole history a second time.
 * - `client_uuid` is null everywhere. These rows predate the PWA; they were
 *   never submitted from an offline queue and must not pretend otherwise.
 */

export interface LegacyFuelFill {
  id: number;
  date: string;
  gauge_percent_before: number;
  liters_added: number;
  liters_before_fill: number | null;
  price_per_liter: number;
  discount: number | null;
  gst: number | null;
  total_cost: number | null;
  notes: string | null;
  created_at: string;
}

export interface LegacyGaugeReading {
  id: number;
  date: string;
  gauge_percent: number;
  notes: string | null;
  created_at: string;
}

export interface LegacyWeatherDay {
  id: number;
  date: string;
  max_temp: number | null;
  min_temp: number | null;
  mean_temp: number | null;
  hdd: number | null;
  source: string | null;
  created_at: string;
}

export interface LegacyHvacReport {
  id: number;
  year: number;
  month: number;
  total_runtime_hours: number;
  avg_cycle_minutes: number | null;
  avg_outdoor_temp: number | null;
  avg_indoor_temp: number | null;
  avg_setpoint: number | null;
  notes: string | null;
  created_at: string;
}

function fail(table: string, id: number, detail: string): never {
  throw new Error(
    `Cannot import ${table} id ${id}: ${detail}. Refusing rather than ` +
      'guessing — this is the only copy of the data.',
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireDate(table: string, id: number, field: string, value: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    fail(table, id, `${field} is not an ISO date (got ${JSON.stringify(value)})`);
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  // Round-trips only if the calendar date actually exists, which is what
  // rejects 2026-02-30.
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    fail(table, id, `${field} is not a real calendar date (${value})`);
  }

  return value;
}

/** Required number. A genuine 0 passes; null, undefined and NaN do not. */
function requireNumber(
  table: string,
  id: number,
  field: string,
  value: unknown,
): number {
  if (value === null || value === undefined || value === '') {
    fail(table, id, `${field} is missing`);
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    fail(table, id, `${field} is not a number (got ${JSON.stringify(value)})`);
  }

  return parsed;
}

/** Optional number. Null stays null — it is not zero. */
function optionalNumber(
  table: string,
  id: number,
  field: string,
  value: unknown,
): number | null {
  if (value === null || value === undefined || value === '') return null;

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    fail(table, id, `${field} is present but not a number (${JSON.stringify(value)})`);
  }

  return parsed;
}

/**
 * SQLite stored timestamps as 'YYYY-MM-DD HH:MM:SS' with no zone. Postgres
 * parses the ISO form reliably; the space-separated form is accepted by some
 * configurations and not others, which is not a thing to leave to chance in a
 * one-shot import.
 */
function normaliseTimestamp(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return new Date().toISOString();
  }

  return value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
}

export function transformFuelFill(row: LegacyFuelFill) {
  const table = 'fuel_fills';

  return {
    id: row.id,
    clientUuid: null,
    date: requireDate(table, row.id, 'date', row.date),
    // Carried across exactly as recorded, including the implausible
    // gauge_percent_before = 0 on 2026-02-24.
    gaugePercentBefore: requireNumber(
      table,
      row.id,
      'gauge_percent_before',
      row.gauge_percent_before,
    ),
    litersAdded: requireNumber(table, row.id, 'liters_added', row.liters_added),
    litersBeforeFill: optionalNumber(
      table,
      row.id,
      'liters_before_fill',
      row.liters_before_fill,
    ),
    pricePerLiter: requireNumber(table, row.id, 'price_per_liter', row.price_per_liter),
    discount: optionalNumber(table, row.id, 'discount', row.discount) ?? 0,
    gst: optionalNumber(table, row.id, 'gst', row.gst),
    totalCost: optionalNumber(table, row.id, 'total_cost', row.total_cost),
    notes: row.notes ?? null,
    createdAt: normaliseTimestamp(row.created_at),
  };
}

export function transformGaugeReading(row: LegacyGaugeReading) {
  const table = 'gauge_readings';

  return {
    id: row.id,
    clientUuid: null,
    date: requireDate(table, row.id, 'date', row.date),
    gaugePercent: requireNumber(table, row.id, 'gauge_percent', row.gauge_percent),
    notes: row.notes ?? null,
    createdAt: normaliseTimestamp(row.created_at),
  };
}

export function transformWeatherDay(row: LegacyWeatherDay) {
  const table = 'weather_data';

  return {
    id: row.id,
    date: requireDate(table, row.id, 'date', row.date),
    maxTemp: optionalNumber(table, row.id, 'max_temp', row.max_temp),
    minTemp: optionalNumber(table, row.id, 'min_temp', row.min_temp),
    meanTemp: optionalNumber(table, row.id, 'mean_temp', row.mean_temp),
    hdd: optionalNumber(table, row.id, 'hdd', row.hdd),
    source: row.source ?? 'manual',
    createdAt: normaliseTimestamp(row.created_at),
  };
}

export function transformHvacReport(row: LegacyHvacReport) {
  const table = 'hvac_reports';

  const month = requireNumber(table, row.id, 'month', row.month);

  if (month < 1 || month > 12) {
    fail(table, row.id, `month is outside 1-12 (got ${month})`);
  }

  return {
    id: row.id,
    year: requireNumber(table, row.id, 'year', row.year),
    month,
    totalRuntimeHours: requireNumber(
      table,
      row.id,
      'total_runtime_hours',
      row.total_runtime_hours,
    ),
    avgCycleMinutes: optionalNumber(table, row.id, 'avg_cycle_minutes', row.avg_cycle_minutes),
    avgOutdoorTemp: optionalNumber(table, row.id, 'avg_outdoor_temp', row.avg_outdoor_temp),
    avgIndoorTemp: optionalNumber(table, row.id, 'avg_indoor_temp', row.avg_indoor_temp),
    avgSetpoint: optionalNumber(table, row.id, 'avg_setpoint', row.avg_setpoint),
    notes: row.notes ?? null,
    createdAt: normaliseTimestamp(row.created_at),
  };
}
