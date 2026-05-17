'use strict';

/**
 * Global Express error handler.
 *
 * Sits at the end of the middleware stack (registered last in index.js).
 * Returns a consistent error envelope so every failure looks the same
 * to API consumers. Stack traces are never sent to clients — they are
 * logged server-side with the route that triggered the error.
 *
 * Usage: app.use(errorHandler) — must be the last app.use() call.
 */
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  console.error({
    message: err.message,
    status,
    route: `${req.method} ${req.originalUrl}`,
    stack: err.stack,
  });

  res.status(status).json({
    success: false,
    error: err.message || 'An unexpected error occurred.',
  });
}

module.exports = errorHandler;
