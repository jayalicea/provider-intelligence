const { logger } = require('../utils/logger');

// Express error-handling middleware (4-argument signature required)
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  if (status >= 500) {
    logger.error('Unhandled error:', {
      message: err.message,
      stack: err.stack,
      method: req.method,
      url: req.originalUrl
    });
  }

  res.status(status).json({
    success: false,
    error: status >= 500 ? 'Internal server error' : err.message
  });
}

module.exports = errorHandler;
