import { env } from '../config/env.js';
import { serverError } from '../utils/http.js';

export function notFoundHandler(req, res) {
  return res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
}

export function errorHandler(error, req, res, next) {
  if (env.nodeEnv !== 'production') {
    console.error(error);
  }

  return serverError(res, 'Something went wrong.');
}
