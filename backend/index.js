'use strict';

require('dotenv').config();

const express = require('express');
const errorHandler = require('./middleware/error-handler');
const complaintsRouter = require('./routes/complaints');
const reportsRouter    = require('./routes/reports');
const heatmapRouter    = require('./routes/heatmap');

const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
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
