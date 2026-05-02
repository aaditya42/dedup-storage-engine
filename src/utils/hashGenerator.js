/**
 * Hash Generator Utility
 * 
 * Provides SHA-256 hashing for both buffers and file streams.
 * Uses Node's built-in crypto module for performance and security.
 */

const crypto = require('crypto');
const fs = require('fs');

/**
 * Generate a SHA-256 hex digest from a Buffer.
 * Used for individual chunk hashing during the upload pipeline.
 * 
 * @param {Buffer} buffer - The data to hash
 * @returns {string} Lowercase hex SHA-256 digest
 */
function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Generate a SHA-256 hex digest from an entire file via streaming.
 * Used to compute a whole-file integrity hash without loading
 * the full file into memory.
 * 
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<string>} Lowercase hex SHA-256 digest
 */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

module.exports = { hashBuffer, hashFile };
