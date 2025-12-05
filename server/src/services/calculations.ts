import { config } from '../config.js';

/**
 * Calculate Heating Degree Days (HDD) from mean temperature
 * HDD = max(0, baseTemp - meanTemp)
 */
export function calculateHDD(meanTemp: number, baseTemp = config.hddBaseTemp): number {
  return Math.max(0, baseTemp - meanTemp);
}

/**
 * Calculate mean temperature from min and max
 */
export function calculateMeanTemp(minTemp: number, maxTemp: number): number {
  return (minTemp + maxTemp) / 2;
}

/**
 * Calculate fuel efficiency in liters per HDD
 */
export function calculateEfficiency(litersUsed: number, totalHDD: number): number {
  return totalHDD > 0 ? litersUsed / totalHDD : 0;
}

/**
 * Estimate liters in tank from gauge percentage
 */
export function estimateLiters(gaugePercent: number, tankCapacity = config.tankCapacity): number {
  return (gaugePercent / 100) * tankCapacity;
}

/**
 * Predict days until refill based on current efficiency and expected HDD/day
 */
export function predictDaysUntilRefill(
  currentLiters: number,
  efficiency: number, // L/HDD
  avgHDDPerDay: number
): number {
  const dailyFuelUse = efficiency * avgHDDPerDay;
  return dailyFuelUse > 0 ? currentLiters / dailyFuelUse : Infinity;
}

/**
 * Predict refill date
 */
export function predictRefillDate(
  fromDate: Date,
  currentLiters: number,
  efficiency: number,
  avgHDDPerDay: number
): Date {
  const days = predictDaysUntilRefill(currentLiters, efficiency, avgHDDPerDay);
  const refillDate = new Date(fromDate);
  refillDate.setDate(refillDate.getDate() + Math.floor(days));
  return refillDate;
}

/**
 * Calculate fuel fill cost with discount and GST
 */
export function calculateFillCost(
  liters: number,
  pricePerLiter: number,
  discountPerLiter = config.discountPerLiter,
  gstRate = config.gstRate
): { gross: number; discount: number; subtotal: number; gst: number; total: number } {
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
export function calculateDailyConsumption(
  litersUsed: number,
  days: number
): number {
  return days > 0 ? litersUsed / days : 0;
}

/**
 * Typical HDD/day by month for Fort Smith
 */
export const typicalHDDByMonth: Record<number, number> = {
  1: 38, // January
  2: 35, // February
  3: 28, // March
  4: 15, // April
  5: 6,  // May
  6: 0,  // June
  7: 0,  // July
  8: 2,  // August
  9: 8,  // September
  10: 15, // October
  11: 28, // November
  12: 36, // December
};

/**
 * Get expected HDD/day for current month
 */
export function getTypicalHDDForMonth(month: number): number {
  return typicalHDDByMonth[month] || 20;
}
