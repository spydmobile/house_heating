import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import { estimateLiters, calculateDailyConsumption, calculateEfficiency } from '../services/calculations.js';

const router = Router();

interface GaugeReading {
  id: number;
  date: string;
  gauge_percent: number;
  notes: string | null;
  created_at: string;
}

interface EnrichedReading extends GaugeReading {
  est_liters: number;
  days_since_last: number | null;
  liters_used: number | null;
  liters_per_day: number | null;
  hdd_period: number | null;
  liters_per_hdd: number | null;
}

// Get all gauge readings with calculated fields
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const readings = db
    .prepare('SELECT * FROM gauge_readings ORDER BY date DESC')
    .all() as GaugeReading[];

  // Enrich with calculated fields
  const enriched: EnrichedReading[] = readings.map((reading, index) => {
    const estLiters = estimateLiters(reading.gauge_percent);
    let daysSinceLast: number | null = null;
    let litersUsed: number | null = null;
    let litersPerDay: number | null = null;
    let hddPeriod: number | null = null;
    let litersPerHdd: number | null = null;

    // Compare with previous reading (next in array since sorted DESC)
    if (index < readings.length - 1) {
      const prevReading = readings[index + 1];
      const currentDate = new Date(reading.date);
      const prevDate = new Date(prevReading.date);
      daysSinceLast = Math.round((currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

      const prevLiters = estimateLiters(prevReading.gauge_percent);
      litersUsed = prevLiters - estLiters;

      // Handle fills (negative consumption means a fill happened)
      if (litersUsed < 0) {
        litersUsed = null;
        litersPerDay = null;
      } else if (daysSinceLast > 0) {
        litersPerDay = calculateDailyConsumption(litersUsed, daysSinceLast);
      }

      // Calculate HDD for period if we have weather data
      if (daysSinceLast > 0 && litersUsed !== null && litersUsed > 0) {
        const hddResult = db
          .prepare(
            `SELECT SUM(hdd) as total_hdd FROM weather_data
             WHERE date > ? AND date <= ?`
          )
          .get(prevReading.date, reading.date) as { total_hdd: number | null };

        if (hddResult?.total_hdd) {
          hddPeriod = hddResult.total_hdd;
          litersPerHdd = calculateEfficiency(litersUsed, hddPeriod);
        }
      }
    }

    return {
      ...reading,
      est_liters: estLiters,
      days_since_last: daysSinceLast,
      liters_used: litersUsed ? Math.round(litersUsed * 10) / 10 : null,
      liters_per_day: litersPerDay ? Math.round(litersPerDay * 100) / 100 : null,
      hdd_period: hddPeriod ? Math.round(hddPeriod * 10) / 10 : null,
      liters_per_hdd: litersPerHdd ? Math.round(litersPerHdd * 1000) / 1000 : null,
    };
  });

  res.json(enriched);
});

// Get single reading
router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const reading = db
    .prepare('SELECT * FROM gauge_readings WHERE id = ?')
    .get(req.params.id);

  if (!reading) {
    res.status(404).json({ error: 'Reading not found' });
    return;
  }
  res.json(reading);
});

// Create new gauge reading
router.post('/', (req: Request, res: Response) => {
  const { date, gauge_percent, notes } = req.body;

  if (!date || gauge_percent === undefined) {
    res.status(400).json({ error: 'Missing required fields: date, gauge_percent' });
    return;
  }

  const db = getDb();
  const result = db
    .prepare('INSERT INTO gauge_readings (date, gauge_percent, notes) VALUES (?, ?, ?)')
    .run(date, gauge_percent, notes || null);

  const reading = db.prepare('SELECT * FROM gauge_readings WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(reading);
});

// Update gauge reading
router.put('/:id', (req: Request, res: Response) => {
  const { date, gauge_percent, notes } = req.body;

  const db = getDb();
  const existing = db.prepare('SELECT * FROM gauge_readings WHERE id = ?').get(req.params.id);

  if (!existing) {
    res.status(404).json({ error: 'Reading not found' });
    return;
  }

  db.prepare('UPDATE gauge_readings SET date = ?, gauge_percent = ?, notes = ? WHERE id = ?').run(
    date,
    gauge_percent,
    notes || null,
    req.params.id
  );

  const reading = db.prepare('SELECT * FROM gauge_readings WHERE id = ?').get(req.params.id);
  res.json(reading);
});

// Delete gauge reading
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM gauge_readings WHERE id = ?').run(req.params.id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Reading not found' });
    return;
  }
  res.status(204).send();
});

export default router;
