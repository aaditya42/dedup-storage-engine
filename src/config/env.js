/**
 * Environment Configuration
 * 
 * Centralises all environment variable access with validation and defaults.
 * Every module reads config from here instead of touching process.env directly,
 * making it trivial to swap values for testing or deployment.
 */

require('dotenv').config();

const config = {
  // ── Server ───────────────────────────────────────────────
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // ── MongoDB ──────────────────────────────────────────────
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/dedup_engine',

  // ── Redis ────────────────────────────────────────────────
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },

  // ── Storage paths ────────────────────────────────────────
  chunkStoragePath: process.env.CHUNK_STORAGE_PATH || './storage/chunks',
  tempUploadPath: process.env.TEMP_UPLOAD_PATH || './uploads',

  // ── Chunking ─────────────────────────────────────────────
  // Default 1 MB chunks — good balance between dedup ratio and I/O overhead
  chunkSizeBytes: parseInt(process.env.CHUNK_SIZE_BYTES, 10) || 1048576,

  // ── Logging ──────────────────────────────────────────────
  logLevel: process.env.LOG_LEVEL || 'debug',
};

module.exports = config;
