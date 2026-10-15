# Plan: Environment Canada climate-archive backfill

**Author:** Resonance
**Date:** 2026-10-15
**Branch:** `feature/climate-archive-backfill`
**Purpose:** Make the window-replacement ROI measurement computable by giving
`weather_data` a complete, homogeneous daily series.
**Parent plan:** `house_heating_plan.md` — Phase 3 *Measurement*, primary goal
*Window Replacement ROI*, baseline 0.191 L/HDD, expected 10–30% improvement.

---

## Why this is needed

| gap | state |
|---|---|
| Q1 2025 daily weather | **zero rows.** `weather_data` begins 2025-09-24 |
| Dec 2025 | 11 days of 31 |
| Jan 2026 | **6 days of 31** |
| Mar 2026 | 0 days |

No HDD means no L/HDD, and L/HDD is the metric. **Both sides of the comparison are
currently unusable, not only the baseline.**

**The existing fetcher cannot do this.** `weatherFetcher.ts` reads
`dd.weather.gc.ca/today/observations/xml/NT/yesterday/yesterday_nt_YYYYMMDD_e.xml` — a
**rolling yesterday file**, not an archive. Its signature `fetchWeatherData(fromDate,
toDate)` reads like a range backfill and is not one; it can only ever retrieve recent days.

---

## THE DECISION THAT MATTERS: which station, and should the whole series be rebuilt

This is not plumbing. **It is the thing most likely to produce a wrong ROI.**

### What was found

`api.weather.gc.ca/collections/climate-stations` lists **three** Fort Smith stations
covering the period:

| STN_ID | climate id | TC id | name | daily coverage |
|---|---|---|---|---|
| **41884** | 2202202 | **ZSM** | FORT SMITH CLIMATE | 2003-08-01 → 2026-10-13 |
| 53119 | 2202201 | YSM | FORT SMITH A | 2014-11-06 → 2026-10-13 |
| 54218 | 2202203 | YSM | FORT SMITH A | 2018-10-29 → 2026-10-13 |

### The problem

1. **`config.weatherStation` is `'ZSM'`** — Fort Smith *Climate*.
2. **`weatherFetcher.ts` accepts `ZSM` *or* `'YSM'` *or* any `station_name` containing
   `"fort smith"`**, and takes the first match in the day's XML.
3. **`weather_data` has no `station` column.** Columns are `id, date, max_temp, min_temp,
   mean_temp, hdd, source, created_at`.

**So the existing 109 rows do not record which station produced them, and the matching
logic permits a mix across dates.** Sources are `imported` (59 rows, 2025-09-24 →
2025-11-21) and `auto` (50 rows, 2025-11-22 → 2026-02-24).

**Fort Smith A is the airport; Fort Smith Climate is a different site with different
exposure.** A before/after efficiency comparison that silently changes station partway
introduces a systematic bias that could be **comparable to or larger than the 10–30%
effect being measured.** This is the failure mode where the measurement looks fine and is
wrong.

### Recommendation — rebuild the whole series from one station

**Station 41884 (ZSM, FORT SMITH CLIMATE).** Reasons:

- It is what `config.weatherStation` already names, so config stops lying.
- **Its daily coverage runs 2003-08-01 → 2026-10-13 — one station covers every period this
  project will ever compare**, including a decade of pre-window baseline if wanted.
- Rebuilding is *simpler* than patching: one homogeneous series beats 109 rows of unknown
  provenance plus gap-fill of a different provenance.

**Rejected alternative:** fill only the holes. It is less work now and leaves the series
provenance-mixed and unauditable, which defeats the measurement it exists to serve.

### Schema change — NOT to be made directly

`weather_data` needs a `station` column so provenance is recorded and this can never
recur. **The house rule is "never modify the database schema directly", so this goes
through a migration in `db/schema.ts` alongside the existing table definitions, reviewed
before it runs, and never as an ad-hoc `ALTER TABLE` against the live file.**

---

## Prerequisite: there is no test framework

`server/` has **no test script, no test runner and no test files.** TDD is not optional
here, so step 1 is adding one. **Proposed: `vitest`** — native TypeScript/ESM, minimal
config, same idiom as the Vite client already in the repo.

This is a `devDependencies` change and the first test infrastructure the project has had.

---

## Architecture

Dependencies point inward; the new code is an outer-layer adapter and touches no
calculation logic.

```
routes/weather.ts            (existing, unchanged for now)
services/
  weatherFetcher.ts          (existing — live/yesterday observations, UNCHANGED)
  climateArchiveFetcher.ts   (NEW — historical daily from the climate archive)
  weatherSync.ts             (existing)
  calculations.ts            (existing — HDD maths, UNCHANGED and REUSED)
db/schema.ts                 (migration adds weather_data.station)
```

**`calculations.ts` is reused, not reimplemented.** HDD must stay
`max(0, 18 − mean_daily_temp)` from one place, or the baseline and the comparison period
can diverge in their definition of the metric — the same class of error as mixing stations.

**Single responsibility:** `climateArchiveFetcher` retrieves and parses; it does not write
to the database and does not compute HDD. Persisting and HDD remain where they already are.

**Fail-fast:** a missing station id, an unparseable response, or a day the archive does not
have is an error that names itself. **No silent defaults, no substituted zero temperature,
no assumed mean when max/min are absent.** A missing day must be recorded as missing, not
filled — a fabricated temperature becomes a fabricated HDD becomes a fabricated ROI.

---

## TDD sequence

Each step is red → green → refactor, one failing test at a time, output shown before
implementation.

1. **Station resolution** — resolving `'ZSM'` returns STN_ID 41884; an unknown code throws
   rather than defaulting.
2. **Parse one archive day** — a known fixture day yields `{date, max_temp, min_temp,
   mean_temp}`; a day with missing max/min yields nulls, **never a computed guess**.
3. **Range request** — a date range produces the expected set of days, and days the archive
   lacks are reported as missing rather than omitted silently.
4. **HDD via `calculations.ts`** — mean −14 °C gives HDD 32; the existing function is
   called, not duplicated.
5. **Idempotent persistence** — re-running a range does not duplicate rows (`date` is
   UNIQUE) and records `station` and `source`.
6. **Provenance guard** — refuse to write a row whose station differs from the series'
   station unless explicitly overridden.

---

## Verification, before any ROI number is produced

- Q1 2025 and Q1 2026 both complete, every day present, one station.
- Known-positive control: a handful of backfilled days compared against the same dates
  from the existing `auto` rows. **If they disagree beyond rounding, that is the
  station-mixing bias made visible, and it is a finding rather than a nuisance.**
- Day counts asserted per month, so "6 of 31" can never again pass as a quarter.

---

## Out of scope

- Computing the ROI. Parked pending Gmail (Franco, 2026-10-15); fuel records are a separate
  gap that weather work does not close.
- The `2026-02-24` fill row recording a 0% tank with empty `liters_before_fill`.
- The `hvac_reports` 2024–25 contradiction (2025-03: 306 h @ −9.5 °C vs 2025-01: 112 h @
  −14.0 °C) — the baseline side of the proxy, needs auditing against source reports.
- `data/fuel.db`, a 0-byte dead file from 2025-12-05.
- `config.port` falling back to the string `'ENV_PORT_NOT_SET'` instead of failing at
  startup — against the house fail-fast rule. Noted, not touched.
