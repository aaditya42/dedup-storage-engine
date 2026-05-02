/**
 * Global Error Handling Middleware
 * 
 * Catches all errors that bubble up from routes and services.
 * Normalises them into a consistent JSON response format.
 * 
 * Must be registered AFTER all routes in the Express pipeline.
 */

const logger = require('../utils/logger');

/**
 * Express error-handling middleware (4-argument signature).
 * 
 * - Known operational errors (with statusCode) → forward as-is
 * - Mongoose validation errors → 400 with field-level details
 * - Multer errors → 400 with user-friendly message
 * - Everything else → 500 Internal Server Error
 */
function errorHandler(err, req, res, _next) {
  // ── Determine status code ──────────────────────────────
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Internal Server Error';
  let details = null;

  // ── Mongoose validation error ──────────────────────────
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
  }

  // ── Mongoose cast error (bad ObjectId, etc.) ───────────
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value for ${err.path}: ${err.value}`;
  }

  // ── Multer file upload errors ──────────────────────────
  if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    message = 'File size exceeds the allowed limit';
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    statusCode = 400;
    message = 'Unexpected file field in upload';
  }

  // ── Log the error ──────────────────────────────────────
  if (statusCode >= 500) {
    logger.error('Unhandled server error', {
      statusCode,
      message,
      stack: err.stack,
      path: req.originalUrl,
      method: req.method,
    });
  } else {
    logger.warn('Client error', {
      statusCode,
      message,
      path: req.originalUrl,
      method: req.method,
    });
  }

  // ── Send response ─────────────────────────────────────
  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(details && { details }),
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}

module.exports = errorHandler;
