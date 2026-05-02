/**
 * Cache Service
 * 
 * Abstraction over Redis for chunk-hash lookups and file-metadata caching.
 * Every method gracefully degrades: if Redis is down, the operation is
 * a silent no-op, and the caller falls through to the database.
 * 
 * Cache key conventions:
 *   chunk:<sha256hash>     → Chunk document JSON
 *   file:<fileId>          → File metadata JSON
 *   file:meta:<fileId>     → Lightweight metadata (no chunk list)
 */

const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');

// TTL in seconds
const CHUNK_CACHE_TTL = 3600;       // 1 hour
const FILE_META_CACHE_TTL = 1800;   // 30 minutes

// ── Key builders ──────────────────────────────────────────────

/** Build a Redis key for a chunk hash lookup */
const chunkKey = (hash) => `chunk:${hash}`;

/** Build a Redis key for full file metadata */
const fileKey = (fileId) => `file:${fileId}`;

/** Build a Redis key for lightweight file metadata */
const fileMetaKey = (fileId) => `file:meta:${fileId}`;

// ── Helpers ───────────────────────────────────────────────────

/**
 * Check whether the Redis client is connected and ready.
 * @returns {boolean}
 */
function isReady() {
  const client = getRedisClient();
  return client && client.status === 'ready';
}

// ── Chunk cache operations ────────────────────────────────────

/**
 * Look up a chunk document by its SHA-256 hash in the cache.
 * 
 * @param {string} hash - SHA-256 hex digest
 * @returns {Promise<Object|null>} Cached chunk document or null
 */
async function getChunkByHash(hash) {
  if (!isReady()) return null;

  try {
    const data = await getRedisClient().get(chunkKey(hash));
    return data ? JSON.parse(data) : null;
  } catch (error) {
    logger.warn('Cache read failed for chunk', { hash, error: error.message });
    return null;
  }
}

/**
 * Store a chunk document in the cache.
 * 
 * @param {string} hash      - SHA-256 hex digest
 * @param {Object} chunkDoc  - Chunk Mongoose document (plain object)
 */
async function setChunkByHash(hash, chunkDoc) {
  if (!isReady()) return;

  try {
    await getRedisClient().setex(
      chunkKey(hash),
      CHUNK_CACHE_TTL,
      JSON.stringify(chunkDoc)
    );
  } catch (error) {
    logger.warn('Cache write failed for chunk', { hash, error: error.message });
  }
}

/**
 * Remove a chunk from the cache (used after reference count changes).
 * 
 * @param {string} hash - SHA-256 hex digest
 */
async function invalidateChunk(hash) {
  if (!isReady()) return;

  try {
    await getRedisClient().del(chunkKey(hash));
  } catch (error) {
    logger.warn('Cache invalidation failed for chunk', { hash, error: error.message });
  }
}

// ── File metadata cache operations ────────────────────────────

/**
 * Retrieve cached file metadata by file ID.
 * 
 * @param {string} fileId - Public UUID of the file
 * @returns {Promise<Object|null>} Cached file document or null
 */
async function getFileMeta(fileId) {
  if (!isReady()) return null;

  try {
    const data = await getRedisClient().get(fileMetaKey(fileId));
    return data ? JSON.parse(data) : null;
  } catch (error) {
    logger.warn('Cache read failed for file meta', { fileId, error: error.message });
    return null;
  }
}

/**
 * Store file metadata in the cache.
 * 
 * @param {string} fileId  - Public UUID of the file
 * @param {Object} fileMeta - File metadata object
 */
async function setFileMeta(fileId, fileMeta) {
  if (!isReady()) return;

  try {
    await getRedisClient().setex(
      fileMetaKey(fileId),
      FILE_META_CACHE_TTL,
      JSON.stringify(fileMeta)
    );
  } catch (error) {
    logger.warn('Cache write failed for file meta', { fileId, error: error.message });
  }
}

/**
 * Remove file metadata from cache (used on delete or update).
 * Clears both the full and lightweight metadata keys.
 * 
 * @param {string} fileId - Public UUID of the file
 */
async function invalidateFileMeta(fileId) {
  if (!isReady()) return;

  try {
    await getRedisClient().del(fileKey(fileId), fileMetaKey(fileId));
  } catch (error) {
    logger.warn('Cache invalidation failed for file', { fileId, error: error.message });
  }
}

module.exports = {
  getChunkByHash,
  setChunkByHash,
  invalidateChunk,
  getFileMeta,
  setFileMeta,
  invalidateFileMeta,
};
