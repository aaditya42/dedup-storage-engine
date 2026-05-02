/**
 * Server Entry Point
 * 
 * Bootstraps all infrastructure (MongoDB, Redis, storage dirs),
 * then starts the HTTP server.
 * 
 * Also handles graceful shutdown on SIGINT / SIGTERM so connections
 * are cleanly closed in production environments (Docker, pm2, etc.).
 */

const app = require('./app');
const config = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
const { connectRedis, disconnectRedis } = require('./config/redis');
const { ensureStorageDir } = require('./services/chunkService');
const logger = require('./utils/logger');

/**
 * Start the application.
 * 
 * Order matters:
 * 1. Ensure storage directories exist
 * 2. Connect to MongoDB (required — crashes if unavailable)
 * 3. Connect to Redis (optional — degrades gracefully)
 * 4. Start listening for HTTP requests
 */
async function start() {
  try {
    // 1. Ensure storage directories exist on disk
    await ensureStorageDir();
    logger.info('Chunk storage directory ready', { path: config.chunkStoragePath });

    // 2. Connect to MongoDB
    await connectDB();

    // 3. Connect to Redis (non-fatal if unavailable)
    await connectRedis();

    // 4. Start the HTTP server
    const server = app.listen(config.port, () => {
      logger.info(`
╔══════════════════════════════════════════════════════════╗
║       Dedup File Storage Engine — Running                ║
║                                                          ║
║   Port:     ${String(config.port).padEnd(44)}║
║   Env:      ${String(config.nodeEnv).padEnd(44)}║
║   MongoDB:  ${String(config.mongoUri).padEnd(44)}║
║   Redis:    ${String(`${config.redis.host}:${config.redis.port}`).padEnd(44)}║
║                                                          ║
║   Health:   http://localhost:${config.port}/health${' '.repeat(Math.max(0, 24 - String(config.port).length))}║
║   API:      http://localhost:${config.port}/api${' '.repeat(Math.max(0, 27 - String(config.port).length))}║
╚══════════════════════════════════════════════════════════╝
      `);
    });

    // ── Graceful shutdown ────────────────────────────────
    const shutdown = async (signal) => {
      logger.info(`${signal} received — shutting down gracefully...`);

      // Stop accepting new connections
      server.close(async () => {
        logger.info('HTTP server closed');

        // Disconnect infrastructure
        await disconnectDB();
        await disconnectRedis();

        logger.info('All connections closed. Goodbye.');
        process.exit(0);
      });

      // Force exit after 10 seconds if graceful shutdown stalls
      setTimeout(() => {
        logger.error('Graceful shutdown timed out — forcing exit');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // ── Unhandled rejection / exception safety nets ──────
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled Rejection', { reason: reason?.toString() });
    });

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
      process.exit(1);
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

start();
