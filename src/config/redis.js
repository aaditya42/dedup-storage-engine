/**
 * Redis Connection Manager
 * 
 * Creates and exports a shared ioredis client.
 * Gracefully degrades — if Redis is unavailable the app still works,
 * it just skips caching (see cacheService).
 */

const Redis = require('ioredis');
const config = require('./env');
const logger = require('../utils/logger');

let redisClient = null;

/**
 * Initialise the Redis client.
 * We use lazyConnect so the app can start even if Redis is temporarily down.
 * @returns {Redis} The shared Redis client instance
 */
function createRedisClient() {
  if (redisClient) return redisClient;

  redisClient = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    lazyConnect: true,           // Don't block startup
    maxRetriesPerRequest: 3,     // Fail fast on individual commands
    retryStrategy(times) {
      // Exponential backoff capped at 3 seconds
      const delay = Math.min(times * 200, 3000);
      logger.warn(`Redis reconnecting in ${delay}ms (attempt ${times})`);
      return delay;
    },
  });

  // ── Event listeners ──────────────────────────────────────
  redisClient.on('connect', () => {
    logger.info('Redis connected', { host: config.redis.host, port: config.redis.port });
  });

  redisClient.on('error', (err) => {
    logger.error('Redis error', { error: err.message });
  });

  redisClient.on('close', () => {
    logger.warn('Redis connection closed');
  });

  return redisClient;
}

/**
 * Attempt to connect the Redis client.
 * Failures are logged but do NOT crash the app.
 */
async function connectRedis() {
  const client = createRedisClient();
  try {
    await client.connect();
    logger.info('Redis connection established');
  } catch (error) {
    logger.warn('Redis connection failed — caching disabled', { error: error.message });
  }
  return client;
}

/**
 * Gracefully disconnect Redis.
 */
async function disconnectRedis() {
  if (redisClient) {
    try {
      await redisClient.quit();
      logger.info('Redis disconnected gracefully');
    } catch (error) {
      logger.error('Error during Redis disconnect', { error: error.message });
    }
  }
}

/**
 * Return the current Redis client (may be null if never initialised).
 */
function getRedisClient() {
  return redisClient;
}

module.exports = { connectRedis, disconnectRedis, getRedisClient };
