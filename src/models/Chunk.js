/**
 * Chunk Model
 * 
 * Represents a single deduplicated chunk stored on disk.
 * 
 * Key design decisions:
 * - `hash` is the SHA-256 digest of the chunk's content (unique index)
 * - `referenceCount` tracks how many File documents reference this chunk;
 *   when it drops to 0 the chunk is eligible for deletion from disk
 * - `filePath` is the absolute path to the chunk file on disk
 * - `size` is stored so we can report storage stats without reading disk
 */

const mongoose = require('mongoose');

const chunkSchema = new mongoose.Schema(
  {
    /** SHA-256 hex digest of the chunk content — primary dedup key */
    hash: {
      type: String,
      required: [true, 'Chunk hash is required'],
      unique: true,
      index: true,
    },

    /** Absolute path to the chunk file on local disk */
    filePath: {
      type: String,
      required: [true, 'Chunk file path is required'],
    },

    /** Size of the chunk in bytes */
    size: {
      type: Number,
      required: [true, 'Chunk size is required'],
      min: [0, 'Chunk size cannot be negative'],
    },

    /**
     * Number of File documents that reference this chunk.
     * Incremented on upload, decremented on file deletion.
     * When it reaches 0, the chunk is purged.
     */
    referenceCount: {
      type: Number,
      required: true,
      default: 1,
      min: [0, 'Reference count cannot be negative'],
    },
  },
  {
    timestamps: true,   // createdAt / updatedAt for auditing
  }
);

// ── Indexes ──────────────────────────────────────────────────
// hash is already unique+indexed above.
// Index on referenceCount for efficient orphan cleanup queries.
chunkSchema.index({ referenceCount: 1 });

const Chunk = mongoose.model('Chunk', chunkSchema);

module.exports = Chunk;
