import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import {
  estimateLiters,
  calculateEfficiency,
  predictDaysUntilRefill,
  predictRefillDate,
  getTypicalHDDForMonth,
  typicalHDDByMonth,
} from '../services/calculations.js';
import { fetchForecast, ForecastDay } from '../services/forecastFetcher.js';
import { config } from '../config.js';

const router = Router();

interface FillRow {
  date: string;
  liters_added: number;
  total_cost: number;
}

interface ReadingRow {
  date: string;
  gauge_percent: number;
}

interface WeatherSummary {
  total_hdd: number | null;
  avg_hdd: number | null;
  avg_temp: number | null;
  days: number;
}

// Get current tank status and efficiency
router.get('/current', (_req: Request, res: Response) => {
  const db = getDb();

  // Get most recent gauge reading
  const latestReading = db
    .prepare('SELECT * FROM gauge_readings ORDER BY date DESC LIMIT 1')
    .get() as ReadingRow | undefined;

  // Get most recent fill
  const latestFill = db
    .prepare('SELECT * FROM fuel_fills ORDER BY date DESC LIMIT 1')
    .get() as FillRow | undefined;

  if (!latestReading) {
    res.json({ error: 'No readings available' });
    return;
  }

  const currentLiters = estimateLiters(latestReading.gauge_percent);
  const readingDate = new Date(latestReading.date);

  // Calculate consumption since last fill
  let consumptionSinceFill: number | null = null;
  let daysSinceFill: number | null = null;
  let efficiencySinceFill: number | null = null;

  if (latestFill) {
    const fillDate = new Date(latestFill.date);
    daysSinceFill = Math.round((readingDate.getTime() - fillDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceFill >= 0) {
      // Tank was full after fill, now at current level
      consumptionSinceFill = config.tankCapacity - currentLiters;

      // Get HDD for this period
      const weatherSummary = db
        .prepare(
          `SELECT SUM(hdd) as total_hdd, AVG(hdd) as avg_hdd, COUNT(*) as days
           FROM weather_data WHERE date > ? AND date <= ?`
        )
        .get(latestFill.date, latestReading.date) as WeatherSummary;

      if (weatherSummary?.total_hdd && consumptionSinceFill > 0) {
        efficiencySinceFill = calculateEfficiency(consumptionSinceFill, weatherSummary.total_hdd);
      }
    }
  }

  // Calculate predictions
  const currentMonth = new Date().getMonth() + 1;
  const typicalHDD = getTypicalHDDForMonth(currentMonth);

  // Use recent efficiency or fall back to typical
  const efficiency = efficiencySinceFill || 0.4; // Default to 0.4 L/HDD
  const daysUntilRefill = predictDaysUntilRefill(currentLiters, efficiency, typicalHDD);
  const refillDate = predictRefillDate(new Date(), currentLiters, efficiency, typicalHDD);

  res.json({
    tank: {
      current_liters: Math.round(currentLiters),
      current_percent: latestReading.gauge_percent,
      capacity: config.tankCapacity,
      reading_date: latestReading.date,
    },
    consumption: {
      since_fill_liters: consumptionSinceFill ? Math.round(consumptionSinceFill) : null,
      days_since_fill: daysSinceFill,
      liters_per_day: daysSinceFill && consumptionSinceFill
        ? Math.round((consumptionSinceFill / daysSinceFill) * 100) / 100
        : null,
    },
    efficiency: {
      current_l_per_hdd: efficiencySinceFill
        ? Math.round(efficiencySinceFill * 1000) / 1000
        : null,
      baseline_q1_2025: 0.191, // Old windows baseline
    },
    prediction: {
      days_until_refill: Math.round(daysUntilRefill),
      estimated_refill_date: refillDate.toISOString().split('T')[0],
      assumed_hdd_per_day: typicalHDD,
      assumed_efficiency: Math.round(efficiency * 1000) / 1000,
    },
  });
});

// Get refill predictions using real forecast + measured efficiency
router.get('/predictions', async (_req: Request, res: Response) => {
  const db = getDb();

  // Get latest reading
  const latestReading = db
    .prepare('SELECT * FROM gauge_readings ORDER BY date DESC LIMIT 1')
    .get() as ReadingRow | undefined;

  if (!latestReading) {
    res.json({ error: 'No readings available' });
    return;
  }

  const currentLiters = estimateLiters(latestReading.gauge_percent);

  // Get most recent fill to calculate actual efficiency
  const latestFill = db
    .prepare('SELECT * FROM fuel_fills ORDER BY date DESC LIMIT 1')
    .get() as FillRow | undefined;

  // Calculate real efficiency from consumption since last fill
  let measuredEfficiency: number | null = null;
  if (latestFill) {
    const consumptionSinceFill = config.tankCapacity - currentLiters;
    const weatherSinceFill = db
      .prepare(
        `SELECT SUM(hdd) as total_hdd FROM weather_data
         WHERE date > ? AND date <= ?`
      )
      .get(latestFill.date, latestReading.date) as { total_hdd: number | null };

    if (weatherSinceFill?.total_hdd && consumptionSinceFill > 0) {
      measuredEfficiency = consumptionSinceFill / weatherSinceFill.total_hdd;
    }
  }

  // Use measured efficiency or fall back to post-window-upgrade estimate
  const efficiency = measuredEfficiency || 0.4;

  // Fetch 7-day forecast
  let forecast: ForecastDay[] = [];
  let forecastHDDPerDay = 25; // Default if forecast fails

  try {
    const forecastData = await fetchForecast();
    forecast = forecastData.forecast;
    forecastHDDPerDay = forecastData.avg_hdd_per_day;
  } catch (err) {
    console.error('Failed to fetch forecast:', err);
  }

  // Calculate day-by-day projection using forecast
  let remainingLiters = currentLiters;
  let daysUntilRefill = 0;
  const refillThreshold = config.tankCapacity * 0.20; // Refill at 20%
  const dailyProjection: Array<{
    date: string;
    hdd: number;
    fuel_used: number;
    remaining_liters: number;
    remaining_percent: number;
  }> = [];

  // Use forecast for first 7 days, then typical HDD
  const today = new Date();
  while (remainingLiters > refillThreshold && daysUntilRefill < 120) {
    const projDate = new Date(today);
    projDate.setDate(projDate.getDate() + daysUntilRefill);
    const dateStr = projDate.toISOString().split('T')[0];

    // Get HDD: from forecast if available, otherwise typical for month
    let dayHDD: number;
    if (daysUntilRefill < forecast.length) {
      dayHDD = forecast[daysUntilRefill].hdd;
    } else {
      const month = projDate.getMonth() + 1;
      dayHDD = getTypicalHDDForMonth(month);
    }

    const fuelUsed = efficiency * dayHDD;
    remainingLiters -= fuelUsed;

    // Only include first 14 days in detailed projection
    if (daysUntilRefill < 14) {
      dailyProjection.push({
        date: dateStr,
        hdd: Math.round(dayHDD * 10) / 10,
        fuel_used: Math.round(fuelUsed * 10) / 10,
        remaining_liters: Math.round(Math.max(0, remainingLiters)),
        remaining_percent: Math.round((Math.max(0, remainingLiters) / config.tankCapacity) * 100),
      });
    }

    daysUntilRefill++;
  }

  const refillDate = new Date(today);
  refillDate.setDate(refillDate.getDate() + daysUntilRefill);

  // Also provide scenario comparisons
  const scenarios = [
    { name: '7-Day Forecast Avg', hdd_per_day: forecastHDDPerDay },
    { name: 'Mild (-10°C avg)', hdd_per_day: 28 },
    { name: 'Normal (-20°C avg)', hdd_per_day: 38 },
    { name: 'Cold (-30°C avg)', hdd_per_day: 48 },
  ];

  const scenarioPredictions = scenarios.map((scenario) => {
    const days = predictDaysUntilRefill(currentLiters, efficiency, scenario.hdd_per_day);
    const date = predictRefillDate(new Date(), currentLiters, efficiency, scenario.hdd_per_day);
    const dailyFuel = efficiency * scenario.hdd_per_day;

    return {
      scenario: scenario.name,
      hdd_per_day: Math.round(scenario.hdd_per_day * 10) / 10,
      daily_fuel_liters: Math.round(dailyFuel * 10) / 10,
      days_until_refill: Math.round(days),
      estimated_refill_date: date.toISOString().split('T')[0],
    };
  });

  res.json({
    current_tank: {
      liters: Math.round(currentLiters),
      percent: latestReading.gauge_percent,
      as_of: latestReading.date,
    },
    efficiency: {
      measured: measuredEfficiency ? Math.round(measuredEfficiency * 1000) / 1000 : null,
      used: Math.round(efficiency * 1000) / 1000,
      source: measuredEfficiency ? 'measured from recent consumption' : 'estimated (post-window upgrade)',
    },
    forecast_based_prediction: {
      days_until_refill: daysUntilRefill,
      estimated_refill_date: refillDate.toISOString().split('T')[0],
      refill_threshold_percent: 20,
      daily_projection: dailyProjection,
    },
    forecast: forecast.length > 0 ? {
      source: 'Open-Meteo',
      days: forecast,
      avg_hdd_per_day: forecastHDDPerDay,
    } : null,
    scenarios: scenarioPredictions,
    typical_hdd_by_month: typicalHDDByMonth,
  });
});

// Get efficiency for a specific period (e.g., Q1 comparison)
router.get('/efficiency', (req: Request, res: Response) => {
  const { from, to, period } = req.query;

  // Handle preset periods
  let fromDate: string;
  let toDate: string;

  if (period === 'q1_2025') {
    fromDate = '2025-01-01';
    toDate = '2025-03-31';
  } else if (period === 'q1_2026') {
    fromDate = '2026-01-01';
    toDate = '2026-03-31';
  } else if (from && to) {
    fromDate = from as string;
    toDate = to as string;
  } else {
    res.status(400).json({ error: 'Specify from/to dates or period (q1_2025, q1_2026)' });
    return;
  }

  const db = getDb();

  // Get weather summary for period
  const weatherSummary = db
    .prepare(
      `SELECT
        COUNT(*) as days,
        SUM(hdd) as total_hdd,
        AVG(hdd) as avg_hdd,
        AVG(mean_temp) as avg_temp,
        MIN(min_temp) as min_temp,
        MAX(max_temp) as max_temp
      FROM weather_data
      WHERE date >= ? AND date <= ?`
    )
    .get(fromDate, toDate) as {
      days: number;
      total_hdd: number | null;
      avg_hdd: number | null;
      avg_temp: number | null;
      min_temp: number | null;
      max_temp: number | null;
    };

  // Get fuel fills in this period
  const fills = db
    .prepare(
      `SELECT SUM(liters_added) as total_liters, SUM(total_cost) as total_cost, COUNT(*) as fill_count
       FROM fuel_fills
       WHERE date >= ? AND date <= ?`
    )
    .get(fromDate, toDate) as { total_liters: number | null; total_cost: number | null; fill_count: number };

  // Calculate efficiency
  let efficiency: number | null = null;
  if (fills?.total_liters && weatherSummary?.total_hdd) {
    efficiency = calculateEfficiency(fills.total_liters, weatherSummary.total_hdd);
  }

  res.json({
    period: { from: fromDate, to: toDate },
    weather: {
      days: weatherSummary?.days || 0,
      total_hdd: weatherSummary?.total_hdd ? Math.round(weatherSummary.total_hdd * 10) / 10 : null,
      avg_hdd_per_day: weatherSummary?.avg_hdd ? Math.round(weatherSummary.avg_hdd * 100) / 100 : null,
      avg_temp: weatherSummary?.avg_temp ? Math.round(weatherSummary.avg_temp * 10) / 10 : null,
      min_temp: weatherSummary?.min_temp,
      max_temp: weatherSummary?.max_temp,
    },
    fuel: {
      total_liters: fills?.total_liters ? Math.round(fills.total_liters * 10) / 10 : null,
      total_cost: fills?.total_cost ? Math.round(fills.total_cost * 100) / 100 : null,
      fill_count: fills?.fill_count || 0,
    },
    efficiency: {
      liters_per_hdd: efficiency ? Math.round(efficiency * 1000) / 1000 : null,
    },
  });
});

// Get cost analysis
router.get('/costs', (_req: Request, res: Response) => {
  const db = getDb();

  // Get all fills
  const fills = db
    .prepare('SELECT * FROM fuel_fills ORDER BY date DESC')
    .all() as FillRow[];

  const totalLiters = fills.reduce((sum, f) => sum + f.liters_added, 0);
  const totalCost = fills.reduce((sum, f) => sum + f.total_cost, 0);
  const avgPricePerLiter = totalLiters > 0 ? totalCost / totalLiters : 0;

  // Get weather for cost per HDD
  const weatherSummary = db
    .prepare('SELECT SUM(hdd) as total_hdd FROM weather_data')
    .get() as { total_hdd: number | null };

  const costPerHDD = weatherSummary?.total_hdd
    ? totalCost / weatherSummary.total_hdd
    : null;

  // Annual projections based on ~7200 HDD/year for Fort Smith
  const annualHDD = 7200;
  const efficiencies = [0.191, 0.35, 0.4, 0.45]; // Various efficiency scenarios

  const projections = efficiencies.map((eff) => {
    const annualLiters = annualHDD * eff;
    const annualCost = annualLiters * avgPricePerLiter;
    return {
      efficiency: eff,
      annual_liters: Math.round(annualLiters),
      annual_cost: Math.round(annualCost * 100) / 100,
    };
  });

  res.json({
    totals: {
      liters: Math.round(totalLiters * 10) / 10,
      cost: Math.round(totalCost * 100) / 100,
      fills: fills.length,
    },
    averages: {
      price_per_liter: Math.round(avgPricePerLiter * 1000) / 1000,
      cost_per_hdd: costPerHDD ? Math.round(costPerHDD * 100) / 100 : null,
    },
    annual_projections: {
      assumed_annual_hdd: annualHDD,
      assumed_price_per_liter: Math.round(avgPricePerLiter * 1000) / 1000,
      scenarios: projections,
    },
    recent_fills: fills.slice(0, 5),
  });
});

export default router;
