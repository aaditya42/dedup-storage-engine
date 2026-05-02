/**
 * File Model
 * 
 * Represents a logical file uploaded by a user.
 * The actual content is stored as an ordered array of chunk references,
 * enabling deduplication across files.
 * 
 * Key design decisions:
 * - `fileId` is a UUID exposed to clients (avoids leaking Mongo ObjectIds)
 * - `chunks` is an ordered array of Chunk ObjectIds; order matters for
 *   faithful reconstruction
 * - `metadata` is a flexible sub-document for MIME type, uploader info, etc.
 */

const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema(
  {
    /** Public-facing UUID — used in API routes instead of ObjectId */
    fileId: {
      type: String,
      required: [true, 'File ID is required'],
      unique: true,
      index: true,
    },

    /** Original filename as provided by the uploader */
    filename: {
      type: String,
      required: [true, 'Filename is required'],
      trim: true,
    },

    /** Total logical size of the file in bytes */
    size: {
      type: Number,
      required: [true, 'File size is required'],
      min: [0, 'File size cannot be negative'],
    },

    /**
     * Ordered array of Chunk references.
     * Position in the array determines byte order during reconstruction.
     */
    chunks: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Chunk',
        required: true,
      },
    ],

    /** Total number of chunks (denormalised for quick metadata responses) */
    totalChunks: {
      type: Number,
      required: true,
      min: [0, 'Total chunks cannot be negative'],
    },

    /** Flexible metadata sub-document */
    metadata: {
      /** MIME type of the original file */
      mimeType: {
        type: String,
        default: 'application/octet-stream',
      },

      /** SHA-256 hash of the complete original file (for integrity checks) */
      fileHash: {
        type: String,
        default: null,
      },

      /** Number of chunks that were already stored (dedup hits) */
      duplicateChunks: {
        type: Number,
        default: 0,
      },

      /** Number of chunks that were newly stored */
      uniqueChunks: {
        type: Number,
        default: 0,
      },

      /** Optional tags or custom key-value pairs */
      custom: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
    },

    /** Soft-delete flag — allows undo and audit trails */
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,    // createdAt / updatedAt
  }
);

// ── Compound indexes ─────────────────────────────────────────
// Speed up listing non-deleted files sorted by upload date
fileSchema.index({ isDeleted: 1, createdAt: -1 });

const File = mongoose.model('File', fileSchema);

module.exports = File;
