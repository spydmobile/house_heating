"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.typicalHDDByMonth = void 0;
exports.calculateHDD = calculateHDD;
exports.calculateMeanTemp = calculateMeanTemp;
exports.calculateEfficiency = calculateEfficiency;
exports.estimateLiters = estimateLiters;
exports.predictDaysUntilRefill = predictDaysUntilRefill;
exports.predictRefillDate = predictRefillDate;
exports.calculateFillCost = calculateFillCost;
exports.calculateDailyConsumption = calculateDailyConsumption;
exports.getTypicalHDDForMonth = getTypicalHDDForMonth;
const config_js_1 = require("../config.js");
/**
 * Calculate Heating Degree Days (HDD) from mean temperature
 * HDD = max(0, baseTemp - meanTemp)
 */
function calculateHDD(meanTemp, baseTemp = config_js_1.config.hddBaseTemp) {
    return Math.max(0, baseTemp - meanTemp);
}
/**
 * Calculate mean temperature from min and max
 */
function calculateMeanTemp(minTemp, maxTemp) {
    return (minTemp + maxTemp) / 2;
}
/**
 * Calculate fuel efficiency in liters per HDD
 */
function calculateEfficiency(litersUsed, totalHDD) {
    return totalHDD > 0 ? litersUsed / totalHDD : 0;
}
/**
 * Estimate liters in tank from gauge percentage
 */
function estimateLiters(gaugePercent, tankCapacity = config_js_1.config.tankCapacity) {
    return (gaugePercent / 100) * tankCapacity;
}
/**
 * Predict days until refill based on current efficiency and expected HDD/day
 */
function predictDaysUntilRefill(currentLiters, efficiency, // L/HDD
avgHDDPerDay) {
    const dailyFuelUse = efficiency * avgHDDPerDay;
    return dailyFuelUse > 0 ? currentLiters / dailyFuelUse : Infinity;
}
/**
 * Predict refill date
 */
function predictRefillDate(fromDate, currentLiters, efficiency, avgHDDPerDay) {
    const days = predictDaysUntilRefill(currentLiters, efficiency, avgHDDPerDay);
    const refillDate = new Date(fromDate);
    refillDate.setDate(refillDate.getDate() + Math.floor(days));
    return refillDate;
}
/**
 * Calculate fuel fill cost with discount and GST
 */
function calculateFillCost(liters, pricePerLiter, discountPerLiter = config_js_1.config.discountPerLiter, gstRate = config_js_1.config.gstRate) {
    const gross = liters * pricePerLiter;
    const discount = liters * discountPerLiter;
    const subtotal = gross - discount;
    const gst = subtotal * gstRate;
    const total = subtotal + gst;
    return {
        gross: Math.round(gross * 100) / 100,
        discount: Math.round(discount * 100) / 100,
        subtotal: Math.round(subtotal * 100) / 100,
        gst: Math.round(gst * 100) / 100,
        total: Math.round(total * 100) / 100,
    };
}
/**
 * Calculate daily fuel consumption between two readings
 */
function calculateDailyConsumption(litersUsed, days) {
    return days > 0 ? litersUsed / days : 0;
}
/**
 * Typical HDD/day by month for Fort Smith
 */
exports.typicalHDDByMonth = {
    1: 38, // January
    2: 35, // February
    3: 28, // March
    4: 15, // April
    5: 6, // May
    6: 0, // June
    7: 0, // July
    8: 2, // August
    9: 8, // September
    10: 15, // October
    11: 28, // November
    12: 36, // December
};
/**
 * Get expected HDD/day for current month
 */
function getTypicalHDDForMonth(month) {
    return exports.typicalHDDByMonth[month] || 20;
}
