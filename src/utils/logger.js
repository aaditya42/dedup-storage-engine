/**
 * Application Logger
 * 
 * Structured logging via Winston.
 * - Console transport with colorised output for development
 * - File transport for production (errors + combined)
 * - JSON format for machine-parseable logs
 */

const winston = require('winston');
const path = require('path');

// Resolve log directory relative to project root
const LOG_DIR = path.resolve(process.cwd(), 'logs');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),    // Capture stack traces
    winston.format.json()                      // Structured JSON output
  ),
  defaultMeta: { service: 'dedup-engine' },
  transports: [
    // ── Console (always active) ──────────────────────────
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length > 1
            ? ` ${JSON.stringify(meta)}`
            : '';
          return `[${timestamp}] ${level}: ${message}${metaStr}`;
        })
      ),
    }),

    // ── Error log file ───────────────────────────────────
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,   // 5 MB rotation
      maxFiles: 5,
    }),

    // ── Combined log file ────────────────────────────────
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: 10 * 1024 * 1024,  // 10 MB rotation
      maxFiles: 5,
    }),
  ],
});

module.exports = logger;
