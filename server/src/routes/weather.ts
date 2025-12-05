import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import { calculateMeanTemp, calculateHDD } from '../services/calculations.js';
import { fetchWeatherData } from '../services/weatherFetcher.js';

const router = Router();

// Get weather data for date range
router.get('/', (req: Request, res: Response) => {
  const { from, to } = req.query;

  const db = getDb();
  let query = 'SELECT * FROM weather_data';
  const params: string[] = [];

  if (from && to) {
    query += ' WHERE date >= ? AND date <= ?';
    params.push(from as string, to as string);
  } else if (from) {
    query += ' WHERE date >= ?';
    params.push(from as string);
  } else if (to) {
    query += ' WHERE date <= ?';
    params.push(to as string);
  }

  query += ' ORDER BY date DESC';

  const weather = db.prepare(query).all(...params);
  res.json(weather);
});

// Get weather summary for date range
router.get('/summary', (req: Request, res: Response) => {
  const { from, to } = req.query;

  if (!from || !to) {
    res.status(400).json({ error: 'Both from and to dates required' });
    return;
  }

  const db = getDb();
  const summary = db
    .prepare(
      `SELECT
        COUNT(*) as days,
        AVG(mean_temp) as avg_temp,
        MIN(min_temp) as min_temp,
        MAX(max_temp) as max_temp,
        SUM(hdd) as total_hdd,
        AVG(hdd) as avg_hdd_per_day
      FROM weather_data
      WHERE date >= ? AND date <= ?`
    )
    .get(from, to);

  res.json(summary);
});

// Manual weather entry
router.post('/', (req: Request, res: Response) => {
  const { date, max_temp, min_temp } = req.body;

  if (!date || max_temp === undefined || min_temp === undefined) {
    res.status(400).json({ error: 'Missing required fields: date, max_temp, min_temp' });
    return;
  }

  const meanTemp = calculateMeanTemp(min_temp, max_temp);
  const hdd = calculateHDD(meanTemp);

  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO weather_data (date, max_temp, min_temp, mean_temp, hdd, source)
     VALUES (?, ?, ?, ?, ?, 'manual')`
  ).run(date, max_temp, min_temp, meanTemp, hdd);

  const weather = db.prepare('SELECT * FROM weather_data WHERE date = ?').get(date);
  res.status(201).json(weather);
});

// Fetch weather from Environment Canada MSC Datamart
router.post('/fetch', async (req: Request, res: Response) => {
  const { from, to } = req.body;

  if (!from || !to) {
    res.status(400).json({ error: 'Both from and to dates required' });
    return;
  }

  try {
    const result = await fetchWeatherData(from, to);
    res.json(result);
  } catch (error) {
    console.error('Weather fetch error:', error);
    res.status(500).json({
      error: 'Failed to fetch weather data',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Delete weather record
router.delete('/:date', (req: Request, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM weather_data WHERE date = ?').run(req.params.date);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Weather record not found' });
    return;
  }
  res.status(204).send();
});

export default router;
