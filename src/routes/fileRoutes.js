/**
 * File Routes
 * 
 * Defines all API endpoints for the dedup file storage engine.
 * Each route applies validation middleware before hitting the controller.
 * 
 * Route summary:
 *   POST   /api/files/upload          → Upload a file
 *   GET    /api/files                 → List all files (paginated)
 *   GET    /api/files/:fileId         → Download a file
 *   GET    /api/files/:fileId/metadata → Get file metadata
 *   DELETE /api/files/:fileId         → Delete a file
 *   GET    /api/stats                 → Storage statistics
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config/env');
const fileController = require('../controllers/fileController');
const {
  validateFileId,
  validatePagination,
  validateFileUpload,
} = require('../middleware/validation');

const router = express.Router();

// ── Multer configuration ─────────────────────────────────────

// Ensure the temp upload directory exists
const uploadDir = path.resolve(config.tempUploadPath);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    // Unique filename to avoid collisions in temp dir
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500 MB max file size
  },
});

// ── Routes ───────────────────────────────────────────────────

// Upload a file
router.post(
  '/files/upload',
  upload.single('file'),       // Multer parses the multipart form
  validateFileUpload,          // Ensure a file was actually provided
  fileController.uploadFile
);

// List all files (paginated)
router.get(
  '/files',
  validatePagination,
  fileController.listFiles
);

// Download a file (reconstruct from chunks)
router.get(
  '/files/:fileId',
  validateFileId,
  fileController.downloadFile
);

// Get file metadata only
router.get(
  '/files/:fileId/metadata',
  validateFileId,
  fileController.getFileMetadata
);

// Delete a file
router.delete(
  '/files/:fileId',
  validateFileId,
  fileController.deleteFile
);

// Storage statistics
router.get(
  '/stats',
  fileController.getStorageStats
);

module.exports = router;
