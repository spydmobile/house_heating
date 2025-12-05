import Database from 'better-sqlite3';
import { config } from '../config.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export function initializeSchema(): void {
  const db = getDb();

  db.exec(`
    -- Fuel fill records
    CREATE TABLE IF NOT EXISTS fuel_fills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      gauge_percent_before REAL NOT NULL,
      liters_added REAL NOT NULL,
      liters_before_fill REAL,
      price_per_liter REAL NOT NULL,
      discount REAL DEFAULT 0,
      gst REAL,
      total_cost REAL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Gauge readings between fills
    CREATE TABLE IF NOT EXISTS gauge_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      gauge_percent REAL NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Daily weather data
    CREATE TABLE IF NOT EXISTS weather_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE NOT NULL,
      max_temp REAL,
      min_temp REAL,
      mean_temp REAL,
      hdd REAL,
      source TEXT DEFAULT 'manual',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- App settings
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- HVAC monthly reports (from Liberty thermostat)
    CREATE TABLE IF NOT EXISTS hvac_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      total_runtime_hours REAL NOT NULL,
      avg_cycle_minutes REAL,
      avg_outdoor_temp REAL,
      avg_indoor_temp REAL,
      avg_setpoint REAL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(year, month)
    );

    -- Create indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_fuel_fills_date ON fuel_fills(date);
    CREATE INDEX IF NOT EXISTS idx_gauge_readings_date ON gauge_readings(date);
    CREATE INDEX IF NOT EXISTS idx_weather_data_date ON weather_data(date);
  `);

  // Insert default settings if not exist
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  insertSetting.run('tank_capacity', '1000');
  insertSetting.run('thermostat_temp', '22');
  insertSetting.run('discount_per_liter', '0.02');
  insertSetting.run('station_id', 'ZSM');
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
