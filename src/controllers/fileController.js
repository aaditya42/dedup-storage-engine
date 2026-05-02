/**
 * File Controller
 * 
 * Thin HTTP layer — validates inputs, delegates to the service layer,
 * and formats responses. Contains zero business logic.
 */

const fileService = require('../services/fileService');
const logger = require('../utils/logger');

/**
 * POST /api/files/upload
 * 
 * Upload a file. Expects multipart/form-data with a "file" field.
 * Optionally accepts a JSON "metadata" field for custom key-value pairs.
 */
async function uploadFile(req, res, next) {
  try {
    // Parse optional custom metadata from the request body
    let customMeta = {};
    if (req.body.metadata) {
      try {
        customMeta = typeof req.body.metadata === 'string'
          ? JSON.parse(req.body.metadata)
          : req.body.metadata;
      } catch {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid metadata JSON' },
        });
      }
    }

    const fileDoc = await fileService.uploadFile(req.file, customMeta);

    res.status(201).json({
      success: true,
      data: {
        fileId: fileDoc.fileId,
        filename: fileDoc.filename,
        size: fileDoc.size,
        totalChunks: fileDoc.totalChunks,
        metadata: fileDoc.metadata,
        createdAt: fileDoc.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/files/:fileId
 * 
 * Download a file. Reconstructs it from chunks and streams it to the client.
 * Sets Content-Type, Content-Disposition, and Content-Length headers.
 */
async function downloadFile(req, res, next) {
  try {
    const { fileId } = req.params;
    const { stream, fileDoc } = await fileService.getFileStream(fileId);

    // Set response headers for proper download behavior
    res.setHeader('Content-Type', fileDoc.metadata.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileDoc.filename)}"`);
    res.setHeader('Content-Length', fileDoc.size);

    // Pipe the reconstructed stream directly to the HTTP response
    stream.pipe(res);

    // Handle stream errors
    stream.on('error', (err) => {
      logger.error('Stream error during file download', {
        fileId,
        error: err.message,
      });
      if (!res.headersSent) {
        next(err);
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/files/:fileId/metadata
 * 
 * Return file metadata without downloading the content.
 */
async function getFileMetadata(req, res, next) {
  try {
    const { fileId } = req.params;
    const fileDoc = await fileService.getFileMetadata(fileId);

    if (!fileDoc) {
      return res.status(404).json({
        success: false,
        error: { message: 'File not found' },
      });
    }

    res.status(200).json({
      success: true,
      data: {
        fileId: fileDoc.fileId,
        filename: fileDoc.filename,
        size: fileDoc.size,
        totalChunks: fileDoc.totalChunks,
        metadata: fileDoc.metadata,
        createdAt: fileDoc.createdAt,
        updatedAt: fileDoc.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/files/:fileId
 * 
 * Soft-delete a file and decrement all chunk reference counts.
 * Chunks with zero references are automatically purged.
 */
async function deleteFile(req, res, next) {
  try {
    const { fileId } = req.params;
    const fileDoc = await fileService.deleteFile(fileId);

    res.status(200).json({
      success: true,
      data: {
        fileId: fileDoc.fileId,
        filename: fileDoc.filename,
        message: 'File deleted successfully. Orphaned chunks have been purged.',
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/files
 * 
 * List all files with pagination.
 * Query params: page (default 1), limit (default 20, max 100)
 */
async function listFiles(req, res, next) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;

    const result = await fileService.listFiles(page, limit);

    res.status(200).json({
      success: true,
      data: result.files,
      pagination: {
        total: result.total,
        page: result.page,
        pages: result.pages,
        limit,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/stats
 * 
 * Return storage and deduplication statistics.
 */
async function getStorageStats(req, res, next) {
  try {
    const stats = await fileService.getStorageStats();

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  uploadFile,
  downloadFile,
  getFileMetadata,
  deleteFile,
  listFiles,
  getStorageStats,
};
