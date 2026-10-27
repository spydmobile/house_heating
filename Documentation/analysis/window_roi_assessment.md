# Window replacement ROI — assessment, 2026-10-27

**Verdict: the effect of the Nov 6-8 2025 window replacement CANNOT be measured
from the current record, and the binding constraint is the consumption data, not
the weather.**

Franco's standing ruling, 2026-10-20: *"refuse to predict and say why."*
Efficiency is measured now or withheld entirely, with the reason and the excluded
periods named. This is the refusal, with its reasons.

## What weather coverage now exists

Closed in the last two days, and it was the thing everyone expected to be the
blocker:

| quarter | usable days | note |
|---|---|---|
| Q1 2025 | **89** of 90 | `2025-01-03` has no measurement at ZSM **or** YSM |
| Q1 2026 | **90** of 90 | nothing unfillable |

`calculateHDD` agrees with the archive's own published figure exactly across both
periods examined here — 647.3 and 321.9 — so the degree-day arithmetic is not in
question.

**Weather is no longer the blocker. It is also no longer the point.**

## Why the quarter comparison is impossible

**There are seven gauge readings in the entire record, and the last is
2025-12-29.**

    2024-10-23  100%     (after a fill)
    2025-02-25  100%     (after a fill)
    2025-09-24  100%     (after a fill)
    2025-11-08   75%     "Windows replaced Nov 6-8"
    2025-11-21  100%     (after a fill)
    2025-12-03   86%     "First reading with new windows in deep winter"
    2025-12-29   93.75%  "15/16 mark" (after the 2025-12-23 fill)

So **Q1 2026 contains no gauge readings at all, and neither does Q1 2025.**
Consumption is derived from the change between two readings; with none in either
quarter there is nothing to compare, at any weather coverage. Backfilling Q1 2026
to 90 of 90 days was worth doing — it will matter as soon as readings exist — but
it could never have unblocked this comparison.

## The only two periods that qualify at all

A period is usable only if no fill falls inside it, since a fill resets the gauge
and breaks the arithmetic. That leaves exactly two:

| | period | gauge | litres | HDD | L/HDD | days |
|---|---|---|---|---|---|---|
| **A** | 2025-09-24 → 2025-11-08 | 100% → 75% | 250 | 647.3 | **0.386** | 44 |
| **B** | 2025-11-21 → 2025-12-03 | 100% → 86% | 140 | 321.9 | **0.435** | 11 |

Taken naively, B is **12.6% WORSE** than A.

**That number must not be reported as the windows making things worse.** Three
independent reasons, each sufficient on its own.

### 1. Period A contains the window installation

The work happened Nov 6-8; period A ends 2025-11-08. The installation is inside
the "before" period, and during it the house was open to outside air. The
contamination is in the direction that makes A look worse, which flatters the
windows — and it is still disqualifying.

### 2. The two periods are not comparable weather

    A: 647.3 HDD over 44 days = 14.7 HDD/day   autumn shoulder
    B: 321.9 HDD over 11 days = 29.3 HDD/day   early deep winter  —  2.0x colder

L/HDD is treated as temperature-independent, and it is not: standby losses,
furnace cycling and wind all push it up as it gets colder. **Comparing a mild
45-day period against a cold 12-day period and attributing the difference to
windows assigns a seasonal effect to a renovation.** On this evidence a house
with no work done at all would likely also show a higher L/HDD in B than in A.

### 3. The signal is inside the gauge's own precision

The gauge is read by eye — 75%, 86%, "15/16 mark". Propagating that tolerance
through both periods:

| gauge tolerance | A (L/HDD) | B (L/HDD) | the "change" spans |
|---|---|---|---|
| ±0.5 pts | 0.378–0.394 | 0.419–0.450 | +6.5% … +19.0% |
| ±1 pt | 0.371–0.402 | 0.404–0.466 | +0.5% … +25.7% |
| ±2 pts | 0.355–0.417 | 0.373–0.497 | **−10.6% … +39.9%** |

**At ±2 points the sign is not even determined.** A 14-point drop read to the
nearest 2 points carries ±14% on its own, which is larger than the effect being
hunted. B rests on a single reading pair — one observation, not a series.

## What it would take to measure this

Nothing here needs more weather, and nothing needs code.

1. **Gauge readings at a regular cadence** — weekly, with a photo, as the
   2025-12-29 entry already does. The analysis is bounded by the number of
   fill-free reading pairs, and there are two in two years.
2. **Readings that bracket a cold spell**, so a post-window period can be
   compared against a pre-window period at a similar HDD/day rather than a
   similar calendar length.
3. **A reading immediately before and after each fill.** Four of the six fills
   have no fill-free period attached to them at all, which is why two years of
   data yields two usable periods.

The strongest available comparison will remain **Q1 2026 against Q1 2025** —
matched days, both quarters now fully covered for weather, 89 usable pairs — and
it becomes computable the moment Q1 2027 has readings in it. The window work is
already far enough in the past that a full winter either side is the right
comparison anyway.

## What is NOT wrong

- the degree-day arithmetic — verified against the archive's own figure across
  176 days with zero discrepancies, and again here
- the weather coverage — 89 of 90 and 90 of 90, provenance recorded per row
- the fill record's litres and costs — those are from invoices and are real

The gap is the gauge, and it is a measurement-practice gap rather than a software
one.

## One row still to audit

The 2026-02-24 fill records `gauge_percent_before = 0` for a reading the note
says was never taken (issue #2). It does not affect anything above: period
selection excludes any period containing a fill, so that row never reaches a
ratio. It is wrong in the record rather than in the arithmetic.
