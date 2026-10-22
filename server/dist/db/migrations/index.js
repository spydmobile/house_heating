"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrations = void 0;
const _001_initial_schema_1 = require("./001_initial_schema");
/**
 * The migration registry, in version order.
 *
 * Adding a migration: create `NNN_name.ts` exporting a `Migration` with the
 * next version number, then append it here. Never edit a migration that has
 * been applied anywhere — write a new one. An applied migration is a fact about
 * a database that already exists; editing it makes the record disagree with the
 * schema and nothing reports the difference.
 */
exports.migrations = [_001_initial_schema_1.initialSchema];
