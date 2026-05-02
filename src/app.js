/**
 * Express Application Setup
 * 
 * Configures the Express app with:
 * - JSON and URL-encoded body parsing
 * - Request logging
 * - API routes
 * - Health check endpoint
 * - 404 handler
 * - Global error handler
 * 
 * Exported separately from the server so it can be tested
 * without actually listening on a port.
 */

const express = require('express');
const path = require('path');
const fileRoutes = require('./routes/fileRoutes');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const app = express();

// ── Body parsing ─────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Request logging ──────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      contentLength: res.get('Content-Length') || 0,
    });
  });

  next();
});

// ── Health check ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
  });
});

// ── API routes ───────────────────────────────────────────────
app.use('/api', fileRoutes);

// ── 404 handler ──────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { message: 'Endpoint not found' },
  });
});

// ── Global error handler (must be last) ──────────────────────
app.use(errorHandler);

module.exports = app;
