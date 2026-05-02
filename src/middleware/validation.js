/**
 * Request Validation Middleware
 * 
 * Uses express-validator to validate incoming requests.
 * Each exported function returns an array of validation middleware
 * that can be spread into route definitions.
 */

const { query, param, validationResult } = require('express-validator');

/**
 * Process validation results and return 400 if any rules failed.
 * Placed at the end of a validation chain.
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Validation failed',
        details: errors.array().map((e) => ({
          field: e.path,
          message: e.msg,
          value: e.value,
        })),
      },
    });
  }

  next();
}

/**
 * Validate the file ID path parameter.
 * Ensures it's a non-empty string that looks like a UUID.
 */
const validateFileId = [
  param('fileId')
    .trim()
    .notEmpty()
    .withMessage('File ID is required')
    .isUUID()
    .withMessage('File ID must be a valid UUID'),
  handleValidationErrors,
];

/**
 * Validate pagination query parameters for the list endpoint.
 */
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
    .toInt(),
  handleValidationErrors,
];

/**
 * Validate that a file is present in the upload.
 * Works with Multer — checks req.file after Multer processes the request.
 */
function validateFileUpload(req, res, next) {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'No file provided. Use the "file" field in a multipart/form-data request.',
      },
    });
  }
  next();
}

module.exports = {
  validateFileId,
  validatePagination,
  validateFileUpload,
};
