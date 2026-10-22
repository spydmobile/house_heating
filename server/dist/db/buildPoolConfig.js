"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPoolConfig = buildPoolConfig;
const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65535;
function parsePort(raw) {
    // Number('') and Number('  ') are both 0, which would pass a NaN check and
    // then fail as an out-of-range port. Reject non-numeric text explicitly.
    if (!/^\d+$/.test(raw.trim())) {
        throw new Error(`DB_PORT must be a number, got ${JSON.stringify(raw)}. ` +
            'Left unchecked this surfaces as a connection failure that looks like ' +
            'the database being unreachable.');
    }
    const port = Number(raw.trim());
    if (port < MIN_TCP_PORT || port > MAX_TCP_PORT) {
        throw new Error(`DB_PORT must be between ${MIN_TCP_PORT} and ${MAX_TCP_PORT}, got ${port}.`);
    }
    return port;
}
function buildPoolConfig(config) {
    return {
        host: config.database.host,
        port: parsePort(config.database.port),
        database: config.database.name,
        user: config.database.user,
        password: config.database.password,
    };
}
