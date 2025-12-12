import { getDb } from '../db/schema.js';
import { fetchWeatherData } from './weatherFetcher.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

let syncInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Get the most recent weather date in the database
 */
function getLatestWeatherDate(): string | null {
  const db = getDb();
  const result = db
    .prepare('SELECT MAX(date) as latest FROM weather_data')
    .get() as { latest: string | null };
  return result?.latest || null;
}

/**
 * Get yesterday's date as YYYY-MM-DD
 */
function getYesterday(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

/**
 * Backfill missing weather data from last known date to yesterday
 */
export async function backfillWeatherData(): Promise<void> {
  const latestDate = getLatestWeatherDate();
  const yesterday = getYesterday();

  if (!latestDate) {
    // No weather data at all - fetch last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fromDate = thirtyDaysAgo.toISOString().split('T')[0];

    console.log(`[WeatherSync] No weather data found. Fetching last 30 days (${fromDate} to ${yesterday})...`);

    try {
      const result = await fetchWeatherData(fromDate, yesterday);
      console.log(`[WeatherSync] Backfill complete: ${result.fetched} days fetched, ${result.skipped} skipped`);
      if (result.errors.length > 0) {
        console.log(`[WeatherSync] Errors: ${result.errors.slice(0, 5).join(', ')}${result.errors.length > 5 ? '...' : ''}`);
      }
    } catch (error) {
      console.error('[WeatherSync] Backfill failed:', error);
    }
    return;
  }

  // Check if we're behind
  if (latestDate >= yesterday) {
    console.log(`[WeatherSync] Weather data is current (latest: ${latestDate})`);
    return;
  }

  // Fetch from day after latest to yesterday
  const fromDate = new Date(latestDate);
  fromDate.setDate(fromDate.getDate() + 1);
  const fromDateStr = fromDate.toISOString().split('T')[0];

  console.log(`[WeatherSync] Fetching missing weather data (${fromDateStr} to ${yesterday})...`);

  try {
    const result = await fetchWeatherData(fromDateStr, yesterday);
    console.log(`[WeatherSync] Sync complete: ${result.fetched} days fetched, ${result.skipped} skipped`);
    if (result.errors.length > 0) {
      console.log(`[WeatherSync] Errors: ${result.errors.slice(0, 5).join(', ')}${result.errors.length > 5 ? '...' : ''}`);
    }
  } catch (error) {
    console.error('[WeatherSync] Sync failed:', error);
  }
}

/**
 * Start automatic weather sync
 * - Runs backfill immediately on startup
 * - Then checks every hour for new data
 */
export async function startWeatherSync(): Promise<void> {
  console.log('[WeatherSync] Starting automatic weather sync...');

  // Run initial backfill
  await backfillWeatherData();

  // Set up hourly check (Environment Canada updates throughout the day)
  syncInterval = setInterval(async () => {
    console.log('[WeatherSync] Running scheduled sync check...');
    await backfillWeatherData();
  }, ONE_HOUR_MS);

  console.log('[WeatherSync] Scheduled sync every hour');
}

/**
 * Stop automatic weather sync
 */
export function stopWeatherSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[WeatherSync] Stopped automatic weather sync');
  }
}
