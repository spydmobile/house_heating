"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const node_path_1 = require("node:path");
function createApp({ clientDistPath, routers }) {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    // --- 1. API routes -------------------------------------------------------
    app.get('/api/health', (_req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    if (routers.fills)
        app.use('/api/fills', routers.fills);
    if (routers.readings)
        app.use('/api/readings', routers.readings);
    if (routers.weather)
        app.use('/api/weather', routers.weather);
    if (routers.analysis)
        app.use('/api/analysis', routers.analysis);
    if (routers.hvac)
        app.use('/api/hvac', routers.hvac);
    // --- 2. Terminate /api so it can never reach the SPA fallback ------------
    app.use('/api', (_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });
    // --- 3. Static assets from the Vite build --------------------------------
    // `index: false` so the static layer does not answer "/" itself; the fallback
    // below owns every HTML response, which keeps that behaviour in one place.
    app.use(express_1.default.static(clientDistPath, {
        index: false,
        // A missing asset must 404 rather than fall through to the HTML shell:
        // a browser handed HTML for a missing .js reports a syntax error pointing
        // at a file that is perfectly fine.
        fallthrough: true,
    }));
    // --- 4. SPA fallback: HTML GETs only -------------------------------------
    app.use((req, res, next) => {
        if (req.method !== 'GET')
            return next();
        // A request that did not ask for HTML (fetch/XHR defaults, an <img>, a
        // stylesheet) must not be answered with the shell.
        if (!req.accepts('html'))
            return next();
        // Anything that looks like a file is a missing asset, not a client route.
        const lastSegment = req.path.split('/').pop() ?? '';
        if (lastSegment.includes('.'))
            return next();
        res.sendFile((0, node_path_1.join)(clientDistPath, 'index.html'));
    });
    // --- 5. Final terminator -------------------------------------------------
    // Express's BUILT-IN 404 responds with its own HTML error page. The status is
    // correct and the body is HTML, so anything that fell past step 4 — a missing
    // asset, a non-GET, a request that did not accept HTML — would still receive
    // HTML. Found by the tests rather than by reading the docs.
    app.use((_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });
    // --- 6. Error handler ----------------------------------------------------
    // Express's DEFAULT error handler also answers with HTML, and in a
    // non-production NODE_ENV it includes the stack trace in the body. Both are
    // wrong here: an API client handed HTML reports a parse error instead of the
    // real failure, and a stack trace is not something to hand to a browser
    // because the framework default happens to.
    //
    // The real error IS logged server-side — swallowing it entirely would trade
    // one silent failure for another.
    //
    // Four arguments, and all four are required: Express identifies error
    // middleware by arity, so dropping the unused `next` silently turns this back
    // into an ordinary handler that never runs.
    app.use((error, _req, res, _next) => {
        console.error('[house-heating] unhandled request error:', error);
        if (res.headersSent)
            return;
        res.status(500).json({ error: 'Internal server error' });
    });
    return app;
}
