/**
 * File Service
 * 
 * Orchestrates the full file lifecycle:
 *   upload  → chunk → dedup → store → record
 *   retrieve → load metadata → reconstruct from chunks → stream
 *   delete  → decrement refs → purge orphans → mark deleted
 * 
 * This is the primary entry point called by the controller layer.
 */

const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const File = require('../models/File');
const chunkService = require('./chunkService');
const cacheService = require('./cacheService');
const { chunkFile } = require('../utils/fileChunker');
const { hashFile } = require('../utils/hashGenerator');
const { reconstructToStream } = require('../utils/fileReconstructor');
const config = require('../config/env');
const logger = require('../utils/logger');

// ── Upload ───────────────────────────────────────────────────

/**
 * Process a file upload end-to-end.
 * 
 * Steps:
 * 1. Generate a UUID for the file
 * 2. Compute whole-file SHA-256 for integrity metadata
 * 3. Stream-chunk the file and dedup each chunk
 * 4. Create a File document referencing the ordered chunk list
 * 5. Clean up the temp upload file
 * 
 * @param {Object}  uploadedFile           - Multer file object
 * @param {string}  uploadedFile.path      - Temp path on disk
 * @param {string}  uploadedFile.originalname - Original filename
 * @param {number}  uploadedFile.size      - File size in bytes
 * @param {string}  uploadedFile.mimetype  - Detected MIME type
 * @param {Object}  [customMeta]           - Optional user-supplied metadata
 * @returns {Promise<Object>} The created File document
 */
async function uploadFile(uploadedFile, customMeta = {}) {
  const fileId = uuidv4();

  logger.info('Starting file upload', {
    fileId,
    filename: uploadedFile.originalname,
    size: uploadedFile.size,
  });

  // 1. Compute whole-file hash (streamed, not buffered)
  const fileHash = await hashFile(uploadedFile.path);

  // 2. Chunk the file and process each through the dedup pipeline
  const chunkIds = [];
  let duplicateChunks = 0;
  let uniqueChunks = 0;

  for await (const { index, data } of chunkFile(uploadedFile.path)) {
    const { chunkDoc, isDuplicate } = await chunkService.processChunk(data);
    chunkIds.push(chunkDoc._id);

    if (isDuplicate) {
      duplicateChunks++;
    } else {
      uniqueChunks++;
    }

    logger.debug('Chunk processed', {
      fileId,
      chunkIndex: index,
      hash: chunkDoc.hash,
      isDuplicate,
    });
  }

  // 3. Create the File document
  const fileDoc = await File.create({
    fileId,
    filename: uploadedFile.originalname,
    size: uploadedFile.size,
    chunks: chunkIds,
    totalChunks: chunkIds.length,
    metadata: {
      mimeType: uploadedFile.mimetype || 'application/octet-stream',
      fileHash,
      duplicateChunks,
      uniqueChunks,
      custom: customMeta,
    },
  });

  // 4. Clean up the temp upload file
  try {
    await fs.unlink(uploadedFile.path);
    logger.debug('Temp upload file removed', { path: uploadedFile.path });
  } catch (err) {
    logger.warn('Failed to remove temp upload file', {
      path: uploadedFile.path,
      error: err.message,
    });
  }

  // 5. Cache the file metadata
  await cacheService.setFileMeta(fileId, fileDoc.toObject());

  logger.info('File upload complete', {
    fileId,
    totalChunks: chunkIds.length,
    duplicateChunks,
    uniqueChunks,
    dedupRatio: chunkIds.length > 0
      ? `${((duplicateChunks / chunkIds.length) * 100).toFixed(1)}%`
      : '0%',
  });

  return fileDoc;
}

// ── Retrieval ────────────────────────────────────────────────

/**
 * Retrieve file metadata by public file ID.
 * Checks cache first, then falls through to MongoDB.
 * 
 * @param {string} fileId - Public UUID
 * @returns {Promise<Object|null>} File document or null
 */
async function getFileMetadata(fileId) {
  // 1. Try cache
  const cached = await cacheService.getFileMeta(fileId);
  if (cached) {
    logger.debug('File metadata cache hit', { fileId });
    return cached;
  }

  // 2. Database lookup
  const fileDoc = await File.findOne({ fileId, isDeleted: false }).lean();
  if (fileDoc) {
    await cacheService.setFileMeta(fileId, fileDoc);
  }

  return fileDoc;
}

/**
 * Reconstruct and return a readable stream of the file's content.
 * 
 * Loads the file's chunk references, resolves their disk paths,
 * and returns a concatenated stream in the correct byte order.
 * 
 * @param {string} fileId - Public UUID
 * @returns {Promise<{ stream: ReadableStream, fileDoc: Object }>}
 * @throws {Error} If the file is not found
 */
async function getFileStream(fileId) {
  // Populate chunk references to get their disk paths
  const fileDoc = await File.findOne({ fileId, isDeleted: false })
    .populate('chunks', 'filePath hash')
    .lean();

  if (!fileDoc) {
    const err = new Error('File not found');
    err.statusCode = 404;
    throw err;
  }

  // Extract ordered chunk paths
  const chunkPaths = fileDoc.chunks.map((chunk) => chunk.filePath);

  // Create the reconstruction stream
  const stream = reconstructToStream(chunkPaths);

  return { stream, fileDoc };
}

// ── Deletion ─────────────────────────────────────────────────

/**
 * Delete a file and clean up its chunk references.
 * 
 * Steps:
 * 1. Load the file document
 * 2. Decrement reference counts on all referenced chunks
 * 3. Mark the file as soft-deleted
 * 4. Invalidate all related caches
 * 
 * @param {string} fileId - Public UUID
 * @returns {Promise<Object>} The deleted file document
 * @throws {Error} If the file is not found
 */
async function deleteFile(fileId) {
  const fileDoc = await File.findOne({ fileId, isDeleted: false });

  if (!fileDoc) {
    const err = new Error('File not found');
    err.statusCode = 404;
    throw err;
  }

  logger.info('Starting file deletion', {
    fileId,
    filename: fileDoc.filename,
    totalChunks: fileDoc.totalChunks,
  });

  // Decrement all chunk references (orphans are auto-purged)
  await chunkService.decrementReferences(fileDoc.chunks);

  // Soft-delete the file record
  fileDoc.isDeleted = true;
  await fileDoc.save();

  // Invalidate caches
  await cacheService.invalidateFileMeta(fileId);

  logger.info('File deleted successfully', { fileId });

  return fileDoc;
}

// ── Listing ──────────────────────────────────────────────────

/**
 * List all non-deleted files with pagination.
 * 
 * @param {number} [page=1]   - Page number (1-indexed)
 * @param {number} [limit=20] - Results per page
 * @returns {Promise<{ files: Object[], total: number, page: number, pages: number }>}
 */
async function listFiles(page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  const [files, total] = await Promise.all([
    File.find({ isDeleted: false })
      .select('-chunks')                     // Exclude chunk array for list view
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    File.countDocuments({ isDeleted: false }),
  ]);

  return {
    files,
    total,
    page,
    pages: Math.ceil(total / limit),
  };
}

// ── Stats ────────────────────────────────────────────────────

/**
 * Compute storage statistics for the deduplication engine.
 * 
 * @returns {Promise<Object>} Aggregate stats
 */
async function getStorageStats() {
  const Chunk = require('../models/Chunk');

  const [fileCount, chunkCount, chunkStats] = await Promise.all([
    File.countDocuments({ isDeleted: false }),
    Chunk.countDocuments(),
    Chunk.aggregate([
      {
        $group: {
          _id: null,
          totalStoredBytes: { $sum: '$size' },
          avgRefCount: { $avg: '$referenceCount' },
          maxRefCount: { $max: '$referenceCount' },
        },
      },
    ]),
  ]);

  const stats = chunkStats[0] || {
    totalStoredBytes: 0,
    avgRefCount: 0,
    maxRefCount: 0,
  };

  return {
    totalFiles: fileCount,
    totalUniqueChunks: chunkCount,
    totalStoredBytes: stats.totalStoredBytes,
    averageReferenceCount: parseFloat(stats.avgRefCount?.toFixed(2) || '0'),
    maxReferenceCount: stats.maxRefCount || 0,
  };
}

module.exports = {
  uploadFile,
  getFileMetadata,
  getFileStream,
  deleteFile,
  listFiles,
  getStorageStats,
};
