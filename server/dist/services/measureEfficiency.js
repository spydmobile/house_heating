"use strict";
/**
 * Measured heating efficiency in litres per heating degree day.
 *
 * Replaces `const efficiency = 0.4` — a constant with a TODO beside it saying
 * the real calculation was never written, sitting in the same file that records
 * 0.191 L/HDD as the old-windows baseline. Refill predictions ran on a number
 * more than double the project's own baseline figure.
 *
 * IT IS ALLOWED TO REFUSE, and that is the design rather than a limitation.
 * L/HDD is litres divided by degree days. The weather series has holes —
 * January 2026 has six days of thirty-one — and litres consumed over such a
 * period are real while the degree days are a fraction of the truth. The ratio
 * comes out INFLATED, and that number then drives a prediction. Franco's
 * ruling, 2026-10-20: refuse to predict and say why.
 *
 * Pure. The periods are supplied by the caller, so every rule here is testable
 * without a database.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.measureEfficiency = measureEfficiency;
function refusal(reason, excluded) {
    return {
        litersPerHdd: null,
        reason,
        qualifyingPeriods: 0,
        totalLiters: 0,
        totalHdd: 0,
        totalDays: 0,
        from: null,
        to: null,
        excluded,
    };
}
/** Why this period cannot contribute, or null if it can. */
function disqualify(period) {
    if (period.hadFill) {
        return 'a fill occurred inside the period, so the gauge difference is not consumption';
    }
    if (period.litersUsed === null) {
        return 'consumption could not be determined for the period';
    }
    if (period.hdd === null) {
        return 'no weather data recorded for the period';
    }
    // Incomplete weather INFLATES the ratio: the litres are real and the degree
    // days are undercounted. This is the exclusion that matters most.
    if (period.weatherDays < period.days) {
        return `incomplete weather coverage — ${period.weatherDays} of ${period.days} days recorded`;
    }
    // Litres per zero degree days is undefined, not infinite and not zero.
    if (period.hdd <= 0) {
        return 'zero degree days in the period, so efficiency is undefined';
    }
    return null;
}
function measureEfficiency(periods) {
    const excluded = [];
    const qualifying = [];
    for (const period of periods) {
        const reason = disqualify(period);
        if (reason === null) {
            qualifying.push(period);
        }
        else {
            excluded.push({ from: period.from, to: period.to, reason });
        }
    }
    if (periods.length === 0) {
        return refusal('no consumption periods available', excluded);
    }
    if (qualifying.length === 0) {
        return refusal(`no qualifying consumption periods — all ${periods.length} were excluded: ` +
            excluded.map((e) => `${e.from}..${e.to} (${e.reason})`).join('; '), excluded);
    }
    // A RATIO OF SUMS, not a mean of ratios. Summing first weights each period by
    // its degree days, so a cold fortnight counts for more than a mild week.
    // Averaging the ratios would give a quiet week equal say.
    const totalLiters = qualifying.reduce((sum, p) => sum + (p.litersUsed ?? 0), 0);
    const totalHdd = qualifying.reduce((sum, p) => sum + (p.hdd ?? 0), 0);
    const totalDays = qualifying.reduce((sum, p) => sum + p.days, 0);
    const dates = qualifying.flatMap((p) => [p.from, p.to]).sort();
    return {
        litersPerHdd: totalLiters / totalHdd,
        reason: null,
        qualifyingPeriods: qualifying.length,
        totalLiters,
        totalHdd,
        totalDays,
        from: dates[0],
        to: dates[dates.length - 1],
        excluded,
    };
}
