"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
// Load .env from project root (parent of server/)
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../.env') });
exports.config = {
    port: process.env.PORT || 'ENV_PORT_NOT_SET',
    dbPath: path_1.default.join(__dirname, '../../data/fuel_tracker.db'),
    // Tank settings
    tankCapacity: 1000, // liters
    // Cost settings
    discountPerLiter: 0.02, // 2 cents
    gstRate: 0.05, // 5%
    // Weather settings
    hddBaseTemp: 18, // Celsius
    weatherStation: 'ZSM', // Fort Smith station ID
    // MSC Datamart base URL
    mscDatamartUrl: 'https://dd.weather.gc.ca',
};
