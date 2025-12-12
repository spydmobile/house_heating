import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { initializeSchema } from './db/schema.js';
import fillsRouter from './routes/fills.js';
import readingsRouter from './routes/readings.js';
import weatherRouter from './routes/weather.js';
import analysisRouter from './routes/analysis.js';
import hvacRouter from './routes/hvac.js';
import { startWeatherSync } from './services/weatherSync.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
initializeSchema();

// Routes
app.use('/api/fills', fillsRouter);
app.use('/api/readings', readingsRouter);
app.use('/api/weather', weatherRouter);
app.use('/api/analysis', analysisRouter);
app.use('/api/hvac', hvacRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(config.port, () => {
  console.log(`Fuel Tracker API running on http://localhost:${config.port}`);
  console.log(`Database: ${config.dbPath}`);

  // Start automatic weather sync after server is ready
  startWeatherSync();
});
