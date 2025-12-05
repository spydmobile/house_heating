import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';

const router = Router();

interface HvacReport {
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

interface FuelConsumption {
  total_liters: number | null;
}

// Get all HVAC reports
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const reports = db
    .prepare('SELECT * FROM hvac_reports ORDER BY year DESC, month DESC')
    .all() as HvacReport[];

  // Enrich with fuel consumption for the month
  const enriched = reports.map((report) => {
    // Get fuel consumption for this month
    const startDate = `${report.year}-${String(report.month).padStart(2, '0')}-01`;
    const endDate = `${report.year}-${String(report.month).padStart(2, '0')}-31`;

    const fuelData = db
      .prepare(
        `SELECT SUM(liters_added) as total_liters FROM fuel_fills
         WHERE date >= ? AND date <= ?`
      )
      .get(startDate, endDate) as FuelConsumption;

    // Calculate liters per runtime hour if we have both
    let litersPerHour: number | null = null;
    if (fuelData?.total_liters && report.total_runtime_hours > 0) {
      litersPerHour = fuelData.total_liters / report.total_runtime_hours;
    }

    return {
      ...report,
      fuel_liters: fuelData?.total_liters || null,
      liters_per_runtime_hour: litersPerHour
        ? Math.round(litersPerHour * 1000) / 1000
        : null,
    };
  });

  res.json(enriched);
});

// Get single report
router.get('/:year/:month', (req: Request, res: Response) => {
  const { year, month } = req.params;
  const db = getDb();

  const report = db
    .prepare('SELECT * FROM hvac_reports WHERE year = ? AND month = ?')
    .get(year, month);

  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  res.json(report);
});

// Create or update HVAC report
router.post('/', (req: Request, res: Response) => {
  const {
    year,
    month,
    total_runtime_hours,
    avg_cycle_minutes,
    avg_outdoor_temp,
    avg_indoor_temp,
    avg_setpoint,
    notes,
  } = req.body;

  if (!year || !month || total_runtime_hours === undefined) {
    res.status(400).json({
      error: 'Missing required fields: year, month, total_runtime_hours',
    });
    return;
  }

  const db = getDb();

  db.prepare(
    `INSERT OR REPLACE INTO hvac_reports
      (year, month, total_runtime_hours, avg_cycle_minutes, avg_outdoor_temp,
       avg_indoor_temp, avg_setpoint, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    year,
    month,
    total_runtime_hours,
    avg_cycle_minutes || null,
    avg_outdoor_temp || null,
    avg_indoor_temp || null,
    avg_setpoint || null,
    notes || null
  );

  const report = db
    .prepare('SELECT * FROM hvac_reports WHERE year = ? AND month = ?')
    .get(year, month);

  res.status(201).json(report);
});

// Delete HVAC report
router.delete('/:year/:month', (req: Request, res: Response) => {
  const { year, month } = req.params;
  const db = getDb();

  const result = db
    .prepare('DELETE FROM hvac_reports WHERE year = ? AND month = ?')
    .run(year, month);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  res.status(204).send();
});

// Get HVAC efficiency analysis
router.get('/analysis/efficiency', (_req: Request, res: Response) => {
  const db = getDb();

  const reports = db
    .prepare(
      `SELECT
        h.*,
        (SELECT SUM(liters_added) FROM fuel_fills
         WHERE strftime('%Y', date) = CAST(h.year AS TEXT)
         AND CAST(strftime('%m', date) AS INTEGER) = h.month) as fuel_liters,
        (SELECT SUM(hdd) FROM weather_data
         WHERE strftime('%Y', date) = CAST(h.year AS TEXT)
         AND CAST(strftime('%m', date) AS INTEGER) = h.month) as total_hdd
      FROM hvac_reports h
      ORDER BY year, month`
    )
    .all() as (HvacReport & { fuel_liters: number | null; total_hdd: number | null })[];

  const analysis = reports.map((r) => {
    const litersPerHour = r.fuel_liters && r.total_runtime_hours > 0
      ? r.fuel_liters / r.total_runtime_hours
      : null;

    const litersPerHdd = r.fuel_liters && r.total_hdd && r.total_hdd > 0
      ? r.fuel_liters / r.total_hdd
      : null;

    return {
      period: `${r.year}-${String(r.month).padStart(2, '0')}`,
      year: r.year,
      month: r.month,
      runtime_hours: r.total_runtime_hours,
      avg_cycle_min: r.avg_cycle_minutes,
      avg_outdoor_temp: r.avg_outdoor_temp,
      fuel_liters: r.fuel_liters,
      total_hdd: r.total_hdd ? Math.round(r.total_hdd * 10) / 10 : null,
      liters_per_hour: litersPerHour ? Math.round(litersPerHour * 1000) / 1000 : null,
      liters_per_hdd: litersPerHdd ? Math.round(litersPerHdd * 1000) / 1000 : null,
    };
  });

  res.json(analysis);
});

export default router;
