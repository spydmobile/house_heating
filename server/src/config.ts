import path from 'path';
import dotenv from 'dotenv';

// Load .env from project root (parent of server/)
dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * DOMAIN constants — the physical and fiscal facts about this house.
 *
 * Deliberately NOT configuration. Server configuration lives in
 * loadServerConfig, which has no defaults and throws when a required variable
 * is absent; these are properties of the tank, the tax rate and the Canadian
 * HDD standard, which no environment variable should be able to change
 * silently.
 *
 * `port` and `dbPath` were removed here on 2026-10-26. `dbPath` pointed at the
 * legacy SQLite file the application no longer reads. `port` was
 * `process.env.PORT || 'ENV_PORT_NOT_SET'` — a silent default, and the kind
 * that is worst: a STRING where a port belongs, so `Number()` of it is NaN.
 * index.ts shadowed it with loadServerConfig's required PORT, so nothing was
 * broken, but it sat here waiting for the next importer to pick up a lie.
 */
export const config = {
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
