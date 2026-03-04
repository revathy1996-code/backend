const express = require('express');
const cors = require('cors');
const vehicleRoutes = require('./routes/vehicleRoutes');
const simulationRoutes = require('./routes/simulationRoutes');
const incidentRoutes = require('./routes/incidentRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const { getAllowedOrigins, isOriginAllowed } = require('./config/cors');

const app = express();
const allowedOrigins = getAllowedOrigins();

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
    origin: (origin, callback) => {
      callback(null, isOriginAllowed(origin, allowedOrigins));
    }
  })
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.use('/api/vehicles', vehicleRoutes);
app.use('/api/simulation', simulationRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/analytics', analyticsRoutes);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: 'Internal server error' });
});

module.exports = app;
