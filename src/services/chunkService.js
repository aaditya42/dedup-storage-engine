/**
 * Chunk Service
 * 
 * Core deduplication logic — the heart of the engine.
 * 
 * Responsibilities:
 * 1. Check if a chunk with a given hash already exists (cache → DB)
 * 2. Store new chunks to disk and create DB entries
 * 3. Increment / decrement reference counts
 * 4. Purge orphaned chunks (refCount === 0) from disk and DB
 */

const fs = require('fs/promises');
const path = require('path');
const Chunk = require('../models/Chunk');
const cacheService = require('./cacheService');
const { hashBuffer } = require('../utils/hashGenerator');
const config = require('../config/env');
const logger = require('../utils/logger');

// ── Storage directory setup ──────────────────────────────────

/**
 * Ensure the chunk storage directory exists.
 * Called once at startup and defensively before writes.
 */
async function ensureStorageDir() {
  await fs.mkdir(config.chunkStoragePath, { recursive: true });
}

/**
 * Build a deterministic, collision-free path for a chunk on disk.
 * Uses the first 4 hex chars as a two-level directory tree to avoid
 * having millions of files in a single folder (which kills FS perf).
 * 
 * Example: hash "a1b2c3d4..." → storage/chunks/a1/b2/a1b2c3d4...
 * 
 * @param {string} hash - SHA-256 hex digest
 * @returns {string} Absolute file path
 */
function chunkFilePath(hash) {
  const dir1 = hash.substring(0, 2);
  const dir2 = hash.substring(2, 4);
  return path.resolve(config.chunkStoragePath, dir1, dir2, hash);
}

// ── Core operations ──────────────────────────────────────────

/**
 * Find an existing chunk by its hash.
 * Checks the Redis cache first; falls through to MongoDB on miss.
 * 
 * @param {string} hash - SHA-256 hex digest
 * @returns {Promise<Object|null>} Chunk document or null
 */
async function findByHash(hash) {
  // 1. Try the cache
  const cached = await cacheService.getChunkByHash(hash);
  if (cached) {
    logger.debug('Chunk cache hit', { hash });
    return cached;
  }

  // 2. Fall through to database
  const chunk = await Chunk.findOne({ hash }).lean();
  if (chunk) {
    // Warm the cache for subsequent lookups
    await cacheService.setChunkByHash(hash, chunk);
  }

  return chunk;
}

/**
 * Process a single chunk through the deduplication pipeline.
 * 
 * Flow:
 * 1. Hash the buffer
 * 2. Check if a chunk with this hash already exists
 * 3. If yes → increment its reference count (dedup hit)
 * 4. If no  → write to disk, create DB entry (dedup miss)
 * 
 * @param {Buffer} data - Raw chunk data
 * @returns {Promise<{ chunkDoc: Object, isDuplicate: boolean }>}
 */
async function processChunk(data) {
  const hash = hashBuffer(data);

  // Check for existing chunk (cache → DB)
  const existing = await findByHash(hash);

  if (existing) {
    // ── Dedup HIT: increment reference count ───────────
    const updated = await Chunk.findOneAndUpdate(
      { hash },
      { $inc: { referenceCount: 1 } },
      { new: true }
    ).lean();

    // Invalidate stale cache entry and re-cache with new refCount
    await cacheService.invalidateChunk(hash);
    await cacheService.setChunkByHash(hash, updated);

    logger.debug('Dedup hit — chunk reused', { hash, refCount: updated.referenceCount });

    return { chunkDoc: updated, isDuplicate: true };
  }

  // ── Dedup MISS: store new chunk ────────────────────────
  const diskPath = chunkFilePath(hash);

  // Ensure the subdirectory exists
  await fs.mkdir(path.dirname(diskPath), { recursive: true });

  // Write chunk data to disk
  await fs.writeFile(diskPath, data);

  // Create database entry
  const chunkDoc = await Chunk.create({
    hash,
    filePath: diskPath,
    size: data.length,
    referenceCount: 1,
  });

  const plainDoc = chunkDoc.toObject();

  // Warm the cache
  await cacheService.setChunkByHash(hash, plainDoc);

  logger.debug('New chunk stored', { hash, size: data.length, path: diskPath });

  return { chunkDoc: plainDoc, isDuplicate: false };
}

/**
 * Decrement the reference count for a chunk.
 * If the count drops to 0, the chunk is deleted from both disk and DB.
 * 
 * @param {string} chunkId - Mongoose ObjectId of the chunk
 * @returns {Promise<void>}
 */
async function decrementReference(chunkId) {
  const chunk = await Chunk.findById(chunkId);
  if (!chunk) {
    logger.warn('Attempted to decrement non-existent chunk', { chunkId });
    return;
  }

  chunk.referenceCount -= 1;

  if (chunk.referenceCount <= 0) {
    // ── Orphan: remove from disk and DB ────────────────
    try {
      await fs.unlink(chunk.filePath);
      logger.debug('Chunk file deleted from disk', { hash: chunk.hash, path: chunk.filePath });
    } catch (err) {
      // File may already be gone — log but don't throw
      if (err.code !== 'ENOENT') {
        logger.error('Failed to delete chunk file', { hash: chunk.hash, error: err.message });
      }
    }

    await Chunk.findByIdAndDelete(chunkId);
    await cacheService.invalidateChunk(chunk.hash);

    logger.info('Orphaned chunk purged', { hash: chunk.hash });
  } else {
    // ── Still referenced: save updated count ───────────
    await chunk.save();
    await cacheService.invalidateChunk(chunk.hash);
    await cacheService.setChunkByHash(chunk.hash, chunk.toObject());

    logger.debug('Chunk reference decremented', {
      hash: chunk.hash,
      refCount: chunk.referenceCount,
    });
  }
}

/**
 * Batch-decrement references for an array of chunk IDs.
 * Processes in parallel with a concurrency limit to avoid
 * overwhelming the DB connection pool.
 * 
 * @param {string[]} chunkIds - Array of Mongoose ObjectIds
 * @returns {Promise<void>}
 */
async function decrementReferences(chunkIds) {
  const CONCURRENCY = 10;

  for (let i = 0; i < chunkIds.length; i += CONCURRENCY) {
    const batch = chunkIds.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((id) => decrementReference(id)));
  }
}

module.exports = {
  ensureStorageDir,
  findByHash,
  processChunk,
  decrementReference,
  decrementReferences,
};
