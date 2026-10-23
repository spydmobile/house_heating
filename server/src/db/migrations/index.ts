import type { Migration } from './runMigrations';
import { initialSchema } from './001_initial_schema';
import { weatherStationProvenance } from './002_weather_station_provenance';

/**
 * The migration registry, in version order.
 *
 * Adding a migration: create `NNN_name.ts` exporting a `Migration` with the
 * next version number, then append it here. Never edit a migration that has
 * been applied anywhere — write a new one. An applied migration is a fact about
 * a database that already exists; editing it makes the record disagree with the
 * schema and nothing reports the difference.
 */
export const migrations: Migration[] = [initialSchema, weatherStationProvenance];
