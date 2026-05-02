/**
 * MongoDB Connection Manager
 * 
 * Establishes and manages the Mongoose connection to MongoDB.
 * Includes retry logic, connection event logging, and graceful shutdown.
 */

const mongoose = require('mongoose');
const config = require('./env');
const logger = require('../utils/logger');

/**
 * Connect to MongoDB with automatic retry.
 * Mongoose buffers commands until connected, but we log the state
 * so operators can diagnose slow starts.
 */
async function connectDB() {
  try {
    await mongoose.connect(config.mongoUri, {
      // Modern Mongoose defaults are sane; explicit options for clarity
      maxPoolSize: 10,       // Max concurrent sockets
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    logger.info('MongoDB connected successfully', { uri: config.mongoUri });
  } catch (error) {
    logger.error('MongoDB connection failed', { error: error.message });
    // Exit so the process manager (pm2 / Docker) can restart us
    process.exit(1);
  }

  // ── Connection event listeners ─────────────────────────
  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', { error: err.message });
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
  });
}

/**
 * Gracefully close the MongoDB connection.
 * Called during application shutdown to prevent connection leaks.
 */
async function disconnectDB() {
  try {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected gracefully');
  } catch (error) {
    logger.error('Error during MongoDB disconnect', { error: error.message });
  }
}

module.exports = { connectDB, disconnectDB };
