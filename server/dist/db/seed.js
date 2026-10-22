"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const schema_js_1 = require("./schema.js");
const calculations_js_1 = require("../services/calculations.js");
const DATA_DIR = path_1.default.join(__dirname, '../../../');
function parseCSV(content) {
    const lines = content.trim().split('\n');
    if (lines.length < 2)
        return [];
    const headers = lines[0].split(',').map((h) => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim() || line.startsWith('#') || line.startsWith('HOW TO USE'))
            break;
        // Handle quoted values with commas
        const values = [];
        let current = '';
        let inQuotes = false;
        for (const char of line) {
            if (char === '"') {
                inQuotes = !inQuotes;
            }
            else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            }
            else {
                current += char;
            }
        }
        values.push(current.trim());
        if (values.length >= headers.length) {
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] || '';
            });
            rows.push(row);
        }
    }
    return rows;
}
function parseNumber(value) {
    if (!value || value === '' || value.includes('#'))
        return null;
    const cleaned = value.replace(/[$,]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
}
function parseDate(value) {
    if (!value || value === '')
        return null;
    // Handle YYYY-MM-DD format
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match)
        return value.substring(0, 10);
    return null;
}
async function seedFuelFills() {
    const filePath = path_1.default.join(DATA_DIR, '43 Staint Annes Fuel Analyzer V1.1.xlsx - Fuel Fills.csv');
    if (!fs_1.default.existsSync(filePath)) {
        console.log('Fuel Fills CSV not found, skipping...');
        return;
    }
    const content = fs_1.default.readFileSync(filePath, 'utf-8');
    const rows = parseCSV(content);
    const db = (0, schema_js_1.getDb)();
    const insert = db.prepare(`
    INSERT INTO fuel_fills (date, gauge_percent_before, liters_added, liters_before_fill,
      price_per_liter, discount, gst, total_cost, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    console.log(`Seeding ${rows.length} fuel fills...`);
    for (const row of rows) {
        const date = parseDate(row['Date']);
        const gaugeBefore = parseNumber(row['Gauge % Before']);
        const litersAdded = parseNumber(row['Liters Added']);
        const pricePerLiter = parseNumber(row['Price $/L']);
        if (!date || gaugeBefore === null || litersAdded === null || pricePerLiter === null) {
            console.log('Skipping invalid row:', row);
            continue;
        }
        const litersBeforeFill = (0, calculations_js_1.estimateLiters)(gaugeBefore);
        const costCalc = (0, calculations_js_1.calculateFillCost)(litersAdded, pricePerLiter);
        insert.run(date, gaugeBefore, litersAdded, litersBeforeFill, pricePerLiter, costCalc.discount, costCalc.gst, costCalc.total, row['Notes'] || null);
    }
    console.log('Fuel fills seeded.');
}
async function seedGaugeReadings() {
    const filePath = path_1.default.join(DATA_DIR, '43 Staint Annes Fuel Analyzer V1.1.xlsx - Gauge Readings.csv');
    if (!fs_1.default.existsSync(filePath)) {
        console.log('Gauge Readings CSV not found, skipping...');
        return;
    }
    const content = fs_1.default.readFileSync(filePath, 'utf-8');
    const rows = parseCSV(content);
    const db = (0, schema_js_1.getDb)();
    const insert = db.prepare(`
    INSERT INTO gauge_readings (date, gauge_percent, notes)
    VALUES (?, ?, ?)
  `);
    console.log(`Seeding gauge readings...`);
    let count = 0;
    for (const row of rows) {
        const date = parseDate(row['Date']);
        const gaugePercent = parseNumber(row['Gauge %']);
        if (!date || gaugePercent === null) {
            continue;
        }
        insert.run(date, gaugePercent, row['Notes'] || null);
        count++;
    }
    console.log(`${count} gauge readings seeded.`);
}
async function seedWeatherData() {
    const filePath = path_1.default.join(DATA_DIR, '43 Staint Annes Fuel Analyzer V1.1.xlsx - Weather Data.csv');
    if (!fs_1.default.existsSync(filePath)) {
        console.log('Weather Data CSV not found, skipping...');
        return;
    }
    const content = fs_1.default.readFileSync(filePath, 'utf-8');
    const rows = parseCSV(content);
    const db = (0, schema_js_1.getDb)();
    const insert = db.prepare(`
    INSERT OR REPLACE INTO weather_data (date, max_temp, min_temp, mean_temp, hdd, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
    console.log(`Seeding weather data...`);
    let count = 0;
    for (const row of rows) {
        const date = parseDate(row['Date']);
        const maxTemp = parseNumber(row['Max Temp (°C)']);
        const minTemp = parseNumber(row['Min Temp (°C)']);
        if (!date)
            continue;
        // Skip rows that look like instructions
        if (date.includes('Download') || date.includes('Search'))
            break;
        let meanTemp = null;
        let hdd = null;
        if (maxTemp !== null && minTemp !== null) {
            meanTemp = (0, calculations_js_1.calculateMeanTemp)(minTemp, maxTemp);
            hdd = (0, calculations_js_1.calculateHDD)(meanTemp);
        }
        insert.run(date, maxTemp, minTemp, meanTemp, hdd, 'imported');
        count++;
    }
    console.log(`${count} weather records seeded.`);
}
async function main() {
    console.log('Initializing database...');
    (0, schema_js_1.initializeSchema)();
    console.log('\nImporting data from CSVs...\n');
    await seedFuelFills();
    await seedGaugeReadings();
    await seedWeatherData();
    console.log('\nDatabase seeded successfully!');
    (0, schema_js_1.closeDb)();
}
main().catch((err) => {
    console.error('Seed failed:', err);
    (0, schema_js_1.closeDb)();
    process.exit(1);
});
