const express = require('express');
const cors = require('cors');
const vehicleRoutes = require('./routes/vehicleRoutes');
const simulationRoutes = require('./routes/simulationRoutes');

const app = express();

app.use((req, res, next) => {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    console.log(`[${timestamp}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`);
  });

  next();
});

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:4200'
  })
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.use('/api/vehicles', vehicleRoutes);
app.use('/api/simulation', simulationRoutes);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: 'Internal server error' });
});

module.exports = app;
