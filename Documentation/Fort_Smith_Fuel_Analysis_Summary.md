# Fort Smith Fuel Consumption Analysis
**Complete Analysis Summary - December 2025**

---

## Table of Contents
1. [Overview](#overview)
2. [Fuel Fill History](#fuel-fill-history)
3. [Key Metrics](#key-metrics)
4. [Understanding Heating Degree Days (HDD)](#understanding-heating-degree-days-hdd)
5. [Window Replacement Impact](#window-replacement-impact)
6. [Weather Data Analysis](#weather-data-analysis)
7. [Cost Analysis](#cost-analysis)
8. [Predictions & Projections](#predictions--projections)
9. [Tracking Tools Created](#tracking-tools-created)
10. [Next Steps](#next-steps)

---

## Overview

This analysis tracks home heating oil consumption for a 1000L tank in Fort Smith, Northwest Territories, correlating fuel usage with weather data (Heating Degree Days) to:
- Measure fuel efficiency
- Predict refill timing
- Quantify window replacement impact
- Track costs and savings

**Tank Specifications:**
- Capacity: 1000 Liters (264 US Gallons)
- Gauge: Fractions (1/8, 1/4, 3/8, 1/2, 5/8, 3/4, 7/8, Full)
- Location: Fort Smith, NWT
- Thermostat Setting: 22°C

**Important Note on Tank Readings:**
- Gauge readings are relative, not absolute
- "100% full" after delivery ≠ exactly 1000L
- For calculations: Each fill resets to 1000L baseline
- Liters added on next fill = actual consumption

---

## Fuel Fill History

### Fill #1: October 23, 2024
- **Date:** 2024-10-23
- **Gauge Before:** 43.2%
- **Liters Added:** 572.3 L
- **Price:** $1.303/L
- **Discount:** $11.45 (2¢/L)
- **GST:** $36.71
- **Total Cost:** $770.51
- **Notes:** First tracked fill

### Fill #2: February 25, 2025
- **Date:** 2025-02-25
- **Gauge Before:** 39.5%
- **Liters Added:** 394.7 L
- **Price:** $1.384/L
- **Discount:** $7.89 (2¢/L)
- **GST:** $26.92
- **Total Cost:** $561.55
- **Notes:** Winter fill
- **Period:** Oct 23 - Feb 25 (125 days)
- **Consumption:** 394.7 L (3.16 L/day)

### Fill #3: September 24, 2025
- **Date:** 2025-09-24
- **Gauge Before:** 14%
- **Liters Added:** 805 L
- **Price:** $1.353/L
- **Discount:** $16.10 (2¢/L)
- **GST:** $53.65
- **Total Cost:** $1,126.82
- **Notes:** Late summer fill
- **Period:** Feb 25 - Sept 24 (212 days)
- **Consumption:** 805 L (3.80 L/day)

### Fill #4: November 21, 2025
- **Date:** 2025-11-21
- **Gauge Before:** 72%
- **Liters Added:** 424.9 L
- **Price:** $1.461/L
- **Discount:** $8.50 (2¢/L)
- **GST:** $30.61
- **Total Cost:** $643.39
- **Notes:** Fall fill - new windows installed Nov 6-8
- **Period:** Sept 24 - Nov 21 (58 days)
- **Consumption:** 425 L (7.33 L/day)

### Gauge Reading: November 8, 2025
- **Date:** 2025-11-08
- **Gauge:** ~75% (just below 3/4 mark)
- **Est. Liters:** ~750 L
- **Notes:** Windows replaced Nov 6-8 (7 windows, 50 years old → state of the art)

### Gauge Reading: December 3, 2025
- **Date:** 2025-12-03
- **Gauge:** ~86% (just below 7/8 mark)
- **Est. Liters:** ~860 L
- **Days since fill:** 12 days (Nov 21 → Dec 3)
- **Consumption:** ~140 L
- **Rate:** 11.7 L/day
- **Period HDD:** 346.0 (avg 28.8 HDD/day)
- **Efficiency:** 0.40 L/HDD
- **Notes:** First reading with new windows in deep winter conditions

---

## Key Metrics

### Current Efficiency (Sept 24 - Nov 21, 2025)
```
Period:           58 days (Sept 24 - Nov 21, 2025)
Fuel Consumed:    425 L
Average Temp:     1.3°C
Total HDD:        971.3
Average HDD/day:  16.75

FUEL EFFICIENCY:  0.438 L/HDD
Daily Average:    7.33 L/day
```

### Historical Efficiency Comparison

| Period | Days | Fuel (L) | Avg Temp | Total HDD | L/HDD | L/day |
|--------|------|----------|----------|-----------|-------|-------|
| Oct 23 - Feb 25 | 125 | 394.7 | -18.0°C | 2,066 | 0.191 | 3.16 |
| Feb 25 - Sept 24 | 212 | 805 | ~10°C | ~2,118 | ~0.38 | 3.80 |
| Sept 24 - Nov 21 | 58 | 425 | 1.3°C | 971.3 | 0.438 | 7.33 |

**Key Observations:**
- Deep winter (Q1) has BETTER efficiency (0.191 L/HDD) than shoulder seasons (0.438 L/HDD)
- This happens because furnaces run more efficiently when running steadily vs. on/off cycling
- Sept-Nov included transition into heating season with lots of cycling

---

## Understanding Heating Degree Days (HDD)

### What is HDD?
Heating Degree Days (HDD) measure how much heating is needed based on outdoor temperature.

**Formula:** HDD = max(0, 18°C - average daily temperature)

### Why 18°C?
- Canadian standard base temperature
- Represents the outdoor temperature below which buildings need heating
- 2-3°C lower than typical indoor setpoint because buildings generate internal heat from:
  - Occupant body heat
  - Solar radiation through windows
  - Appliances and equipment

### Examples

| Outdoor Temp | Calculation | HDD | Heating Need |
|--------------|-------------|-----|--------------|
| 20°C | 18 - 20 = -2 → 0 | 0 | No heating needed |
| 15°C | 18 - 15 = 3 | 3 | Minimal heating |
| 5°C | 18 - 5 = 13 | 13 | Moderate heating |
| 0°C | 18 - 0 = 18 | 18 | Significant heating |
| -10°C | 18 - (-10) = 28 | 28 | Heavy heating |
| -20°C | 18 - (-20) = 38 | 38 | Maximum heating |

### Why HDD is Useful
1. **Weather-normalized comparison:** Compare consumption across different temperature conditions
2. **Predictive:** Forecast fuel consumption based on weather forecasts
3. **Fair comparison:** Measure window/insulation improvements accounting for weather differences
4. **Standard metric:** Enables comparison with other buildings and years

### Your Personal Note
- Your thermostat is set to 22°C (not 18°C)
- This is fine! The 18°C base is a measurement standard, not your setpoint
- Your 0.438 L/HDD already includes your 22°C preference
- As long as you keep your thermostat consistent, year-over-year comparisons are valid

---

## Window Replacement Impact

### Timeline
**November 6-8, 2025:** Main floor window replacement
- **Quantity:** 7 windows
- **Previous:** 50-year-old windows
- **New:** State-of-the-art energy-efficient windows
- **Cost:** $2,000 per window × 7 = $14,000 total investment

### Measurement Challenge
The Nov 21 fill captured the entire Sept 24 - Nov 21 period (425L), which includes:
- 46 days with OLD windows (Sept 24 - Nov 8)
- 13 days with NEW windows (Nov 9 - Nov 21)

**Problem:** We can't separate these periods accurately without additional gauge readings or fills between Nov 8 and Nov 21.

### Q1 2025 Baseline (Old Windows)

**Period:** January 1 - March 31, 2025 (90 days)
```
Average Temperature:  -18.0°C (deep winter)
Total HDD:            3,200.2
Average HDD/day:      35.56

Estimated Consumption: 611.4 L
Efficiency (OLD):      0.191 L/HDD
Daily Fuel Rate:       6.79 L/day
```

### Q1 2026 Measurement Plan (New Windows)
**Goal:** Compare Q1 2026 (Jan-Mar 2026 with new windows) to Q1 2025 baseline

**Why Q1 is Ideal:**
- Coldest period = maximum heating demand
- Window impact most measurable in cold weather
- Same seasonal conditions year-over-year
- Full fuel fill cycles available

**Expected Improvement Scenarios:**

| Scenario | Efficiency | Q1 Fuel Use | Savings vs Old | Annual Savings | Cost Savings/yr |
|----------|------------|-------------|----------------|----------------|-----------------|
| 10% improvement | 0.172 L/HDD | 550 L | 61 L | ~244 L | ~$334 |
| 20% improvement | 0.153 L/HDD | 489 L | 122 L | ~488 L | ~$669 |
| 30% improvement | 0.134 L/HDD | 428 L | 183 L | ~732 L | ~$1,003 |

*(Annual extrapolation based on ~7,200 HDD/year typical for Fort Smith)*

### Measurement Timeline
- **April 2026:** Download Q1 2026 weather data
- **Calculate:** Q1 2026 L/HDD efficiency
- **Compare:** New vs 0.191 L/HDD baseline
- **Result:** Quantified window ROI

---

## Weather Data Analysis

### Sept 24 - Nov 21, 2025 Period

**Temperature Summary:**
- Days: 59 (including Nov 21)
- Average Temperature: 1.3°C
- Minimum Temperature: -18.0°C
- Maximum Temperature: 17.9°C
- Total HDD: 971.3
- Average HDD/day: 16.75

**Weekly Breakdown:**

| Week | Dates | Avg Temp | Total HDD | Est. Fuel Used |
|------|-------|----------|-----------|----------------|
| 1 | Sept 24-30 | 9.4°C | 60.5 | ~26.5 L |
| 2 | Oct 1-7 | 4.8°C | 92.1 | ~40.3 L |
| 3 | Oct 8-14 | 4.4°C | 95.3 | ~41.7 L |
| 4 | Oct 15-21 | 3.5°C | 101.8 | ~44.5 L |
| 5 | Oct 22-28 | 3.9°C | 99.0 | ~43.3 L |
| 6 | Oct 29 - Nov 4 | 0.9°C | 102.4 | ~44.8 L |
| 7 | Nov 5-11 | -5.0°C | 161.0 | ~70.4 L |
| 8 | Nov 12-18 | -7.4°C | 177.6 | ~77.7 L |
| 9 | Nov 19-21 | -9.2°C | 81.6 | ~35.7 L |

**Observations:**
- Temperature dropped dramatically in November
- Weeks 7-8 (mid-November) had highest consumption (~70-78L/week)
- This corresponds with window replacement period (Nov 6-8 during Week 7)

### Nov 21 - Dec 3, 2025 Period (Post-Fill #4)

**Temperature Summary:**
- Days: 12
- Average Temperature: -10.0°C
- Minimum Temperature: -19.5°C (Dec 2)
- Maximum Temperature: 0.7°C (Nov 22)
- Total HDD: 346.0
- Average HDD/day: 28.8

**Daily Weather Data:**

| Date | High (°C) | Low (°C) | Mean (°C) | HDD |
|------|-----------|----------|-----------|-----|
| Nov 21 | -1.9 | -9.5 | -5.7 | 23.7 |
| Nov 22 | 0.7 | -10.6 | -5.0 | 23.0 |
| Nov 23 | -4.9 | -13.7 | -9.3 | 27.3 |
| Nov 24 | -4.8 | -7.2 | -6.0 | 24.0 |
| Nov 25 | -7.2 | -9.5 | -8.4 | 26.4 |
| Nov 26 | -8.7 | -11.4 | -10.1 | 28.1 |
| Nov 27 | -9.4 | -12.6 | -11.0 | 29.0 |
| Nov 28 | -12.0 | -14.2 | -13.1 | 31.1 |
| Nov 29 | -13.0 | -16.7 | -14.9 | 32.9 |
| Nov 30 | -14.0 | -17.1 | -15.6 | 33.6 |
| Dec 1 | -13.1 | -15.1 | -14.1 | 32.1 |
| Dec 2 | -14.1 | -19.5 | -16.8 | 34.8 |
| **Total** | | | **Avg: -10.0°C** | **346.0** |

**Observations:**
- Temperature dropped steadily through the period
- Transitioned from mild (-5°C) to deep winter (-17°C)
- HDD increased from ~23/day to ~35/day
- This is the first tracked period entirely with new windows

**Efficiency Analysis (New Windows):**
```
Period:           12 days (Nov 21 - Dec 3, 2025)
Fuel Consumed:    ~140 L
Total HDD:        346.0
Average HDD/day:  28.8

FUEL EFFICIENCY:  0.40 L/HDD
Daily Average:    11.7 L/day
```

**Comparison to Previous Periods:**
| Period | Avg Temp | HDD/day | L/HDD | Notes |
|--------|----------|---------|-------|-------|
| Oct 23 - Feb 25 | -18.0°C | 16.5 | 0.191 | Old windows, deep winter |
| Sept 24 - Nov 21 | 1.3°C | 16.75 | 0.438 | Mixed old/new windows |
| **Nov 21 - Dec 3** | **-10.0°C** | **28.8** | **0.40** | **New windows only** |

The 0.40 L/HDD efficiency with new windows is promising - better than shoulder season (0.438) but we need more deep winter data to compare properly with Q1 2025 baseline (0.191).

### Data Source
**Station:** Fort Smith Climate (Station ID: 2202202)
**Location:** 60.03°N, 111.93°W
**Operator:** NAVCAN
**Elevation:** 205.10 m

**Access:**
- Historical: https://collaboration.cmc.ec.gc.ca/cmc/climate/Get_More_Data_Plus_de_donnees/
- Real-time (30-day): https://dd.weather.gc.ca/ (MSC Datamart)

---

## Cost Analysis

### Pricing Structure
**Your Discount:** 2¢/L flat rate (commercial/bulk customer)

**Cost Calculation:**
1. Gross Cost = Liters × Price/L
2. Discount = Liters × $0.02
3. Subtotal = Gross - Discount
4. GST = Subtotal × 5%
5. **Total = Subtotal + GST**

### Fill Cost Summary

| Date | Liters | Price/L | Gross | Discount | Subtotal | GST | Total |
|------|--------|---------|-------|----------|----------|-----|-------|
| Oct 23, 2024 | 572.3 | $1.303 | $745.65 | $11.45 | $734.20 | $36.71 | $770.51 |
| Feb 25, 2025 | 394.7 | $1.384 | $546.22 | $7.89 | $538.33 | $26.92 | $561.55 |
| Sept 24, 2025 | 805.0 | $1.353 | $1,089.17 | $16.10 | $1,073.07 | $53.65 | $1,126.82 |
| Nov 21, 2025 | 424.9 | $1.461 | $620.78 | $8.50 | $612.28 | $30.61 | $643.39 |
| **TOTAL** | **2,196.9** | **Avg: $1.375** | - | **$43.94** | - | **$147.89** | **$3,102.27** |

### Cost Metrics (Sept 24 - Nov 21)
```
Total Spent:        $643.39
Period:             58 days
Average Price/L:    $1.375 (all fills)
Cost per Day:       $11.09/day
Cost per HDD:       $0.66/HDD
```

### Annual Cost Projection
**Based on typical Fort Smith climate (~7,200 HDD/year):**

| Efficiency | Annual Fuel | Cost @ $1.37/L | Cost @ $1.50/L |
|------------|-------------|----------------|----------------|
| 0.191 L/HDD (Winter) | 1,375 L | $1,884 | $2,063 |
| 0.438 L/HDD (Current) | 3,154 L | $4,321 | $4,731 |

**Window Impact on Costs:**
If new windows provide 20% improvement (0.438 → 0.350 L/HDD):
- Annual fuel: 2,520 L (vs 3,154 L)
- **Annual savings: 634 L**
- **Cost savings: $869/year @ $1.37/L**
- **Payback period: 16.1 years** ($14,000 ÷ $869/year)

---

## Predictions & Projections

### Current Tank Status (as of Nov 21, 2025)
- **Tank Level:** 100% (1000 L after fill)
- **Current Efficiency:** 0.438 L/HDD
- **Recent HDD/day:** 16.75 (Sept 24 - Nov 21 average)

### Refill Predictions

#### Scenario 1: If Conditions Continue (16.7 HDD/day)
```
Daily Fuel Use:     7.33 L/day
Days from Fill:     136 days
Estimated Refill:   April 6, 2026
```

#### Scenario 2: Mild Winter (15 HDD/day)
```
Daily Fuel Use:     6.56 L/day
Days from Fill:     152 days
Estimated Refill:   April 22, 2026
```

#### Scenario 3: Normal Winter (20 HDD/day)
```
Daily Fuel Use:     8.75 L/day
Days from Fill:     114 days
Estimated Refill:   March 15, 2026
```

#### Scenario 4: Cold Winter (25 HDD/day)
```
Daily Fuel Use:     10.94 L/day
Days from Fill:     91 days
Estimated Refill:   February 20, 2026
```

### Fort Smith Typical HDD/day by Month
- **September:** 5-8 HDD/day
- **October:** 10-15 HDD/day
- **November:** 15-20 HDD/day
- **December-February:** 20-25+ HDD/day (deep winter)
- **March:** 15-20 HDD/day
- **April:** 8-12 HDD/day

### Most Likely Scenario
Given Fort Smith's climate:
- **December-February will average 22-25 HDD/day**
- **Realistic refill timing: Mid-February to Early March 2026**
- **Expected consumption: ~700-800L from 1000L fill**

### How to Use Forecasts
1. **Check 7-day weather forecast**
2. **Estimate average temperature for the week**
3. **Calculate HDD:** For each day, HDD = 18 - avg_temp
4. **Sum weekly HDD**
5. **Multiply by 0.438 L/HDD** = weekly fuel consumption
6. **Divide current tank level by daily rate** = days until refill

**Example:**
- Forecast: Next 7 days average -5°C
- HDD/day: 18 - (-5) = 23 HDD
- Weekly HDD: 23 × 7 = 161 HDD
- Weekly fuel: 161 × 0.438 = **70.5 L**
- Daily: **10.1 L/day**

---

## Tracking Tools Created

### 1. Fort_Smith_Fuel_Analyzer_Complete.xlsx

Comprehensive Excel workbook with 5 sheets:

#### Sheet 1: Fuel Fills
- Records all fuel deliveries
- Tracks: Date, gauge %, liters added, price, discount, GST, total cost
- Auto-calculates costs based on 2¢/L discount and 5% GST
- **Use:** Enter each fill as it occurs

#### Sheet 2: Gauge Readings
- Track consumption between fills
- Enter: Date and Gauge %
- Auto-calculates: Est. liters, days since last reading, consumption, L/day
- Optional: Enter HDD period for L/HDD calculation
- **Use:** Record gauge weekly (e.g., every Sunday morning)

**Example Workflow:**
```
Nov 21:  100%  1000L  (Fill)
Nov 28:   93%   930L  → 70L used, 10.0 L/day
Dec 5:    86%   860L  → 70L used, 10.0 L/day
Dec 12:   78%   780L  → 80L used, 11.4 L/day
```

#### Sheet 3: Weather Data
- Daily temperature and HDD data
- Dates: Sept 24 - Nov 21, 2025 (pre-filled)
- Formulas auto-calculate Mean Temp and HDD
- **Use:** Add future months' weather data as needed

#### Sheet 4: Analysis
- Fuel consumption summary
- Weather summary (total HDD, avg temp, avg HDD/day)
- **KEY METRIC: Liters per HDD** (0.438 currently)
- Predictions for various winter scenarios
- Cost analysis section
- **Use:** Review metrics, monitor efficiency changes

#### Sheet 5: Q1 Comparison
- Q1 2025 baseline (OLD windows): 0.191 L/HDD
- Template for Q1 2026 data (NEW windows)
- Impact measurement calculations
- **Use:** Fill in Q1 2026 data in April 2026

#### Sheet 6: Instructions
- Complete guide on using the workbook
- Weather data download instructions
- HDD explanation
- Typical Fort Smith HDD/day by season

### Key Features
✓ Auto-calculating formulas throughout
✓ Color-coded sections for easy navigation
✓ Pre-filled with your historical data
✓ Ready for ongoing tracking
✓ Cost tracking with discount structure
✓ Window impact measurement framework

---

## Next Steps

### Immediate Actions (Now - December 2025)

1. **Weekly Gauge Readings**
   - Check tank every Sunday morning
   - Record in Gauge Readings sheet
   - Enter date and gauge %
   - Track consumption patterns

2. **Weather Tracking**
   - Download December 2025 weather data monthly
   - Add to Weather Data sheet
   - Monitor HDD patterns

3. **Cost Tracking**
   - Record every fuel fill in Fuel Fills sheet
   - Track price trends
   - Monitor average cost per HDD

### Short-term (January - March 2026)

1. **Continue Tracking**
   - Weekly gauge readings throughout winter
   - Record all fuel fills
   - Download monthly weather data

2. **Monitor Consumption**
   - Compare daily L/HDD to baseline
   - Watch for efficiency improvements
   - Track total Q1 2026 fuel usage

3. **Cost Analysis**
   - Compare Q1 2026 costs to Q1 2025
   - Calculate actual heating costs for coldest period

### Q1 2026 Window Impact Measurement (April 2026)

1. **Data Collection**
   - Download Jan-Mar 2026 complete weather data
   - Calculate Q1 2026 total HDD
   - Sum Q1 2026 total fuel consumption

2. **Efficiency Calculation**
   ```
   Q1 2026 L/HDD = Total Fuel Used ÷ Total HDD
   ```

3. **Impact Analysis**
   ```
   Improvement = (0.191 - Q1_2026_LHDD) ÷ 0.191 × 100%
   ```

4. **ROI Calculation**
   - Calculate annual fuel savings
   - Multiply by average fuel price
   - Determine payback period

5. **Update Q1 Comparison Sheet**
   - Fill in all Q1 2026 data
   - Review calculated improvements
   - Document results

### Long-term (Ongoing)

1. **Annual Reviews**
   - Compare year-over-year fuel consumption
   - Track cost trends
   - Monitor efficiency changes

2. **Optimize Heating**
   - Use predictions to optimize fill timing
   - Take advantage of price variations
   - Plan fills when tank is 25-30% (250-300L)

3. **Data Collection**
   - Maintain consistent weekly gauge readings
   - Record every fill without exception
   - Download weather data monthly

4. **Equipment Monitoring**
   - Watch for unusual consumption spikes
   - Early warning of system issues
   - Validate window performance over time

---

## Summary

### Current Status (as of Dec 3, 2025)
- **Tank:** ~86% (~860 L)
- **Consumption since fill:** ~140 L in 12 days (11.7 L/day)
- **Current Efficiency:** 0.40 L/HDD (new windows)
- **Windows:** New windows installed Nov 6-8, 2025
- **Next Fill:** Expected mid-February to early March 2026 (~73 days at current rate)

### Key Insights
1. **Seasonal Efficiency Varies:**
   - Deep winter (Q1): 0.191 L/HDD (steady furnace operation)
   - Shoulder seasons: 0.438 L/HDD (on/off cycling less efficient)

2. **Window Impact Unknown Yet:**
   - Need Q1 2026 data for proper measurement
   - Expect to see 15-30% improvement
   - Measurement in April 2026

3. **Cost Structure:**
   - Average fuel price: ~$1.37/L
   - 2¢/L discount on all fills
   - 5% GST on discounted amount
   - Annual heating costs: $3,000-4,000 (depending on efficiency and weather)

4. **Predictive Power:**
   - HDD strongly correlates with fuel consumption
   - Weather forecasts enable consumption prediction
   - Can optimize fill timing and budgeting

### Tools Available
- ✅ Comprehensive Excel tracker
- ✅ Gauge reading system for real-time monitoring
- ✅ Q1 comparison framework
- ✅ Cost analysis templates
- ✅ Weather data integration

### Success Metrics
- **Track weekly:** Gauge readings every Sunday
- **Track monthly:** Download weather data
- **Track annually:** Calculate yearly efficiency
- **Measure impact:** Q1 2026 vs Q1 2025 comparison

---

## Appendix: Quick Reference

### Formulas

**HDD Calculation:**
```
HDD = max(0, 18°C - average_daily_temperature)
```

**Fuel Consumption:**
```
Daily_Fuel = HDD_per_day × L_per_HDD
```

**Days Until Refill:**
```
Days_Remaining = Current_Tank_Liters ÷ Daily_Fuel_Use
```

**Efficiency:**
```
L_per_HDD = Total_Fuel_Used ÷ Total_HDD_Period
```

**Cost per Fill:**
```
Total_Cost = ((Liters × Price_per_L) - (Liters × 0.02)) × 1.05
```

### Contact Information

**Weather Data Source:**
- Environment Canada Climate Data
- Direct Link: https://collaboration.cmc.ec.gc.ca/cmc/climate/Get_More_Data_Plus_de_donnees/
- Station: Fort Smith Climate (2202202)

**Tool Files:**
- Fort_Smith_Fuel_Analyzer_Complete.xlsx
- All data through Nov 21, 2025 pre-filled
- Ready for ongoing tracking

### Document Info
- **Created:** December 2025
- **Last Updated:** December 3, 2025
- **Location:** Fort Smith, Northwest Territories, Canada
- **Data Owner:** Franco Nogarin

---

*End of Analysis Summary*
