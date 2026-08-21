'use strict';

require('dotenv').config();

const express = require('express');
const errorHandler = require('./middleware/error-handler');
const complaintsRouter = require('./routes/complaints');
const reportsRouter    = require('./routes/reports');
const heatmapRouter    = require('./routes/heatmap');
const { getCacheStatus } = require('./services/cache');

const app = express();

// Allow the Vite dev server (any localhost/127.0.0.1 port, since Vite falls back
// to 5174/5175/etc. when 5173 is already taken by another project) and any
// Vercel preview URLs to call the API without CORS errors. In production,
// restrict this to the real dashboard origin.
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || LOCALHOST_ORIGIN_RE.test(origin) || origin.endsWith('.vercel.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

// Health endpoint — includes cache freshness so the dashboard live indicator
// can display "Live / Stale / Offline" without a separate API call.
app.get('/health', async (req, res) => {
  try {
    const cacheStatus = await getCacheStatus();
    res.json({
      success: true,
      data: {
        status: cacheStatus.isCriticallyStale ? 'critical' : cacheStatus.isStale ? 'stale' : 'fresh',
        age_hours: cacheStatus.ageHours === Infinity ? null : cacheStatus.ageHours,
        last_computed: cacheStatus.lastComputed,
      },
    });
  } catch {
    res.json({
      success: true,
      data: { status: 'unknown', age_hours: null, last_computed: null },
    });
  }
});

app.use('/api/complaints', complaintsRouter);
app.use('/api/reports',    reportsRouter);
app.use('/api/heatmap',    heatmapRouter);

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const ENV = process.env.NODE_ENV || 'development';

app.listen(PORT, () => {
  console.log(`NashAlert backend running on port ${PORT} [${ENV}]`);
});

module.exports = app;
