# Session Handoff: SpyD Home Heat

**Date:** 2025-12-05 16:00 MST
**Repository:** house_heating
**Model:** Claude Opus 4.5 (claude-opus-4-5-20251101)

---

## Project Overview

**SpyD Home Heat** is a fuel consumption tracking webapp for a property in Fort Smith, Northwest Territories. It correlates heating oil usage with weather data (Heating Degree Days) to measure efficiency, predict refill timing, and quantify the impact of home improvements (notably new window installation).

### Tech Stack
- **Frontend:** React + Vite + TypeScript + Tailwind CSS v4
- **Backend:** Node.js + Express + TypeScript
- **Database:** SQLite (via better-sqlite3)
- **Weather Data:** Environment Canada MSC Datamart (historical) + Open-Meteo API (forecasts)

---

## What Was Accomplished This Session

### 1. HVAC Report Data Import
Imported 13 months of Liberty thermostat HVAC Health Reports (Nov 2024 - Nov 2025) from PDF files in `heating_reports/` folder.

**Data extracted per report:**
- Total runtime hours
- Average cycle duration (minutes)
- Average outdoor temperature
- Average indoor temperature
- Average setpoint

**Key historical notes added:**
- **Nov 2024:** "Stopped using wood furnace around this time - oil only from now on"
- **Dec 2024:** "First full month on oil furnace only (no wood)"
- **Nov 2025:** "New windows installed Nov 6-8. 3 days of high furnace use during install while windows were out."

### 2. Dynamic Forecast-Based Predictions
Completely rewrote the predictions system to use real data instead of static values.

**New features:**
- **Open-Meteo API integration** (`server/src/services/forecastFetcher.ts`) - fetches 7-day weather forecast for Fort Smith (60.009, -111.883)
- **Measured efficiency calculation** - uses actual consumption since last fill divided by HDD
- **Day-by-day projection** - projects tank level using forecast (7 days) + typical HDD (beyond)
- **14-day visual tank projection** with color-coded progress bars (green/yellow/red)
- **Weather scenario comparisons** (forecast avg, mild, normal, cold)

**Key files modified:**
- `server/src/services/forecastFetcher.ts` (new)
- `server/src/routes/analysis.ts` - rewrote `/predictions` endpoint
- `client/src/types/index.ts` - added new interfaces
- `client/src/components/PredictionCard.tsx` - complete rewrite with new UI

### 3. UI Improvements
- Added Font Awesome `temperature-half` icon as favicon with thermometer emoji fallback
- Updated page title to "SpyD Home Heat"

---

## Current System State

### Running Services
- **Backend:** http://localhost:3001 (Express API)
- **Frontend:** http://localhost:5173 (Vite dev server)

### Database Location
`/Users/franconogarin/localcode/house_heating/data/fuel_tracker.db`

### Current Tank Status (as of Dec 3, 2025)
- **Level:** 86% (~860L)
- **Last fill:** Nov 21, 2025 (1000L full)
- **Consumption since fill:** ~140L in 12 days

### Prediction Summary
- **Days until refill:** ~44 (Jan 18, 2026)
- **Efficiency used:** 0.4 L/HDD (estimated, post-window upgrade)
- **Current 7-day forecast:** Avg 43 HDD/day (brutal cold snap Dec 5-8)

---

## Important Domain Context

### Two Major Heating Paradigm Shifts

1. **Nov/Dec 2024:** Stopped using wood furnace, switched to oil-only heating
   - All data before this includes supplemental wood heat
   - Efficiency comparisons should account for this

2. **Nov 6-8, 2025:** New windows installed
   - 3-day spike in furnace runtime during installation (windows out)
   - Post-installation efficiency expected to be significantly better
   - This is the key improvement being tracked

### Key Metrics
- **HDD (Heating Degree Days):** `max(0, 18 - mean_daily_temp)`
- **L/HDD:** Liters per Heating Degree Day (efficiency measure)
- **Baseline Q1 2025 (old windows):** 0.191 L/HDD
- **Post-window estimate:** ~0.4 L/HDD (higher due to shoulder season cycling)

### Tank Specifications
- Capacity: 1000 Liters
- Refill threshold: 20% (200L)
- Location: Fort Smith, NWT

---

## API Endpoints

### Analysis
- `GET /api/analysis/current` - Current tank status and efficiency
- `GET /api/analysis/predictions` - **NEW** Forecast-based predictions with day-by-day projection
- `GET /api/analysis/efficiency?period=q1_2025` - Period efficiency analysis
- `GET /api/analysis/costs` - Cost analysis and projections

### Data Entry
- `GET/POST /api/fills` - Fuel fill records
- `GET/POST /api/readings` - Gauge readings
- `GET/POST /api/weather` - Weather data
- `POST /api/weather/fetch?from=DATE&to=DATE` - Fetch from EC Datamart
- `GET/POST /api/hvac` - HVAC thermostat reports

---

## File Structure (Key Files)

```
house_heating/
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── PredictionCard.tsx      # Rewritten this session
│   │   │   ├── TankGauge.tsx
│   │   │   ├── HvacReportForm.tsx
│   │   │   └── HvacReportsTable.tsx
│   │   └── types/
│   │       └── index.ts                # Updated with new prediction types
│   └── index.html                      # Updated favicon + title
├── server/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── analysis.ts             # Updated predictions endpoint
│   │   │   ├── hvac.ts
│   │   │   ├── fills.ts
│   │   │   └── weather.ts
│   │   ├── services/
│   │   │   ├── forecastFetcher.ts      # NEW - Open-Meteo API
│   │   │   ├── weatherFetcher.ts       # EC Datamart historical
│   │   │   └── calculations.ts
│   │   └── db/
│   │       └── schema.ts
├── data/
│   └── fuel_tracker.db
├── heating_reports/                     # HVAC PDF reports (13 files)
└── Documentation/
    └── ProjectHandoffs/
```

---

## Database Schema (Key Tables)

```sql
-- HVAC thermostat reports
CREATE TABLE hvac_reports (
  id INTEGER PRIMARY KEY,
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

-- Also: fuel_fills, gauge_readings, weather_data, settings
```

---

## Pending/Future Work

### High Priority
1. **Measured efficiency calculation** - Currently returns null because weather data doesn't fully overlap with consumption period. Need to ensure weather data is up-to-date.

2. **Weather data gap** - Fetch weather for Dec 3-5, 2025 to enable measured efficiency calculation.

### Nice to Have
- Add chart showing HVAC runtime vs fuel consumption correlation
- Year-over-year comparison (Nov 2024 vs Nov 2025)
- Cost savings calculation from new windows
- PWA/mobile optimization
- Notification when tank reaches threshold

### Data Entry Needed
- Continue adding gauge readings as they're taken
- Add December HVAC report when available

---

## Commands to Start Development

```bash
# Terminal 1: Start backend
cd /Users/franconogarin/localcode/house_heating/server
npm run dev

# Terminal 2: Start frontend
cd /Users/franconogarin/localcode/house_heating/client
npm run dev

# Access app at http://localhost:5173
# API at http://localhost:3001
```

---

## Testing the Predictions API

```bash
# Get forecast-based predictions
curl -s http://localhost:3001/api/analysis/predictions | python3 -m json.tool

# Get current tank status
curl -s http://localhost:3001/api/analysis/current | python3 -m json.tool

# Get HVAC reports
curl -s http://localhost:3001/api/hvac | python3 -m json.tool
```

---

## Notes for Next Session

1. The efficiency is currently using the fallback estimate (0.4 L/HDD) because `measuredEfficiency` returns null. This is likely because weather data doesn't cover the full period since last fill. Fetching recent weather data should fix this.

2. The HVAC reports now have rich context in their notes fields about the wood furnace transition and window installation.

3. The brutal cold snap (Dec 5-8) with -30°C temps is reflected in the forecast - expect high fuel consumption ~17-20L/day.

4. Environment Canada's citypage_weather XML endpoint appears to be down/moved. Open-Meteo is used as the forecast source instead.
