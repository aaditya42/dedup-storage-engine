/**
 * File Chunker Utility
 * 
 * Splits a file into fixed-size chunks using streaming I/O.
 * This ensures large files never load entirely into memory —
 * each chunk is yielded as soon as it's ready.
 * 
 * Uses an async generator so the caller can process chunks
 * one-at-a-time or collect them all.
 */

const fs = require('fs');
const config = require('../config/env');
const logger = require('./logger');

/**
 * Split a file into fixed-size chunks via streaming.
 * 
 * The function reads the file in highWaterMark-sized pieces and
 * accumulates them into a buffer. Whenever the buffer reaches
 * `chunkSize`, a chunk is yielded and the buffer resets.
 * Any remaining data is yielded as the final (smaller) chunk.
 * 
 * @param {string} filePath  - Absolute path to the source file
 * @param {number} [chunkSize] - Bytes per chunk (default from config)
 * @yields {{ index: number, data: Buffer }} Ordered chunk objects
 */
async function* chunkFile(filePath, chunkSize = config.chunkSizeBytes) {
  const stream = fs.createReadStream(filePath, {
    highWaterMark: chunkSize,   // Read in chunk-sized bites for efficiency
  });

  let buffer = Buffer.alloc(0);
  let chunkIndex = 0;

  for await (const piece of stream) {
    // Accumulate incoming data
    buffer = Buffer.concat([buffer, piece]);

    // Yield full chunks as soon as we have enough data
    while (buffer.length >= chunkSize) {
      const chunk = buffer.subarray(0, chunkSize);
      yield { index: chunkIndex, data: Buffer.from(chunk) };
      buffer = buffer.subarray(chunkSize);
      chunkIndex++;
    }
  }

  // Yield the remaining data as the final (possibly smaller) chunk
  if (buffer.length > 0) {
    yield { index: chunkIndex, data: buffer };
    chunkIndex++;
  }

  logger.debug(`File chunked successfully`, {
    filePath,
    totalChunks: chunkIndex,
    chunkSize,
  });
}

/**
 * Convenience wrapper that collects all chunks into an array.
 * Useful when you need random access to chunks (e.g., parallel processing).
 * 
 * @param {string} filePath  - Absolute path to the source file
 * @param {number} [chunkSize] - Bytes per chunk
 * @returns {Promise<Array<{ index: number, data: Buffer }>>}
 */
async function chunkFileToArray(filePath, chunkSize = config.chunkSizeBytes) {
  const chunks = [];
  for await (const chunk of chunkFile(filePath, chunkSize)) {
    chunks.push(chunk);
  }
  return chunks;
}

module.exports = { chunkFile, chunkFileToArray };
