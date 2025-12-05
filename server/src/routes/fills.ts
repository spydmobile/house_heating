import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import { calculateFillCost, estimateLiters } from '../services/calculations.js';

const router = Router();

// Get all fuel fills
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const fills = db
    .prepare(
      `SELECT * FROM fuel_fills ORDER BY date DESC`
    )
    .all();
  res.json(fills);
});

// Get single fuel fill
router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const fill = db
    .prepare('SELECT * FROM fuel_fills WHERE id = ?')
    .get(req.params.id);

  if (!fill) {
    res.status(404).json({ error: 'Fill not found' });
    return;
  }
  res.json(fill);
});

// Create new fuel fill
router.post('/', (req: Request, res: Response) => {
  const { date, gauge_percent_before, liters_added, price_per_liter, notes } = req.body;

  if (!date || gauge_percent_before === undefined || !liters_added || !price_per_liter) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const litersBeforeFill = estimateLiters(gauge_percent_before);
  const costCalc = calculateFillCost(liters_added, price_per_liter);

  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO fuel_fills (date, gauge_percent_before, liters_added, liters_before_fill,
        price_per_liter, discount, gst, total_cost, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      date,
      gauge_percent_before,
      liters_added,
      litersBeforeFill,
      price_per_liter,
      costCalc.discount,
      costCalc.gst,
      costCalc.total,
      notes || null
    );

  const fill = db.prepare('SELECT * FROM fuel_fills WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(fill);
});

// Update fuel fill
router.put('/:id', (req: Request, res: Response) => {
  const { date, gauge_percent_before, liters_added, price_per_liter, notes } = req.body;

  const db = getDb();
  const existing = db.prepare('SELECT * FROM fuel_fills WHERE id = ?').get(req.params.id);

  if (!existing) {
    res.status(404).json({ error: 'Fill not found' });
    return;
  }

  const litersBeforeFill = estimateLiters(gauge_percent_before);
  const costCalc = calculateFillCost(liters_added, price_per_liter);

  db.prepare(
    `UPDATE fuel_fills SET date = ?, gauge_percent_before = ?, liters_added = ?,
      liters_before_fill = ?, price_per_liter = ?, discount = ?, gst = ?,
      total_cost = ?, notes = ? WHERE id = ?`
  ).run(
    date,
    gauge_percent_before,
    liters_added,
    litersBeforeFill,
    price_per_liter,
    costCalc.discount,
    costCalc.gst,
    costCalc.total,
    notes || null,
    req.params.id
  );

  const fill = db.prepare('SELECT * FROM fuel_fills WHERE id = ?').get(req.params.id);
  res.json(fill);
});

// Delete fuel fill
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM fuel_fills WHERE id = ?').run(req.params.id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Fill not found' });
    return;
  }
  res.status(204).send();
});

export default router;
