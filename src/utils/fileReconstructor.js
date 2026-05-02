/**
 * File Reconstructor Utility
 * 
 * Reassembles a complete file from its ordered list of chunk file paths.
 * Uses streaming I/O to handle arbitrarily large files without
 * blowing up memory.
 */

const fs = require('fs');
const { pipeline } = require('stream/promises');
const { PassThrough } = require('stream');
const logger = require('./logger');

/**
 * Reconstruct a file by concatenating chunks in order.
 * 
 * Streams each chunk file sequentially into the output stream.
 * This keeps memory usage proportional to one chunk at a time,
 * regardless of the total file size.
 * 
 * @param {string[]} chunkPaths   - Ordered array of absolute paths to chunk files
 * @param {string}   outputPath   - Absolute path for the reconstructed file
 * @returns {Promise<void>}
 */
async function reconstructToFile(chunkPaths, outputPath) {
  const writeStream = fs.createWriteStream(outputPath);

  for (const chunkPath of chunkPaths) {
    // Verify each chunk file exists before attempting to read
    if (!fs.existsSync(chunkPath)) {
      throw new Error(`Chunk file not found: ${chunkPath}`);
    }

    // Pipe each chunk into the output, one at a time
    await new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(chunkPath);
      readStream.on('error', reject);
      readStream.on('end', resolve);
      readStream.pipe(writeStream, { end: false }); // Keep writer open for next chunk
    });
  }

  // Close the write stream after all chunks are written
  writeStream.end();

  // Wait for the write stream to finish flushing to disk
  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  logger.debug('File reconstructed successfully', {
    outputPath,
    totalChunks: chunkPaths.length,
  });
}

/**
 * Reconstruct a file and return a readable stream instead of writing to disk.
 * Useful for direct HTTP streaming to the client without a temp file.
 * 
 * @param {string[]} chunkPaths - Ordered array of absolute paths to chunk files
 * @returns {ReadableStream} A readable stream of the concatenated file
 */
function reconstructToStream(chunkPaths) {
  const passThrough = new PassThrough();

  // Self-invoking async function to pipe chunks sequentially
  (async () => {
    try {
      for (const chunkPath of chunkPaths) {
        if (!fs.existsSync(chunkPath)) {
          passThrough.destroy(new Error(`Chunk file not found: ${chunkPath}`));
          return;
        }

        await new Promise((resolve, reject) => {
          const readStream = fs.createReadStream(chunkPath);
          readStream.on('error', (err) => {
            passThrough.destroy(err);
            reject(err);
          });
          readStream.on('end', resolve);
          readStream.pipe(passThrough, { end: false });
        });
      }

      // Signal end of data
      passThrough.end();
    } catch (error) {
      if (!passThrough.destroyed) {
        passThrough.destroy(error);
      }
    }
  })();

  return passThrough;
}

module.exports = { reconstructToFile, reconstructToStream };
