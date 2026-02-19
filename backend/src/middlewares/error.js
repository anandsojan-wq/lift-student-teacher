import { env } from '../config/env.js';
import { badRequest, serverError } from '../utils/http.js';

export function notFoundHandler(req, res) {
  return res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
}

export function errorHandler(error, req, res, next) {
  if (error?.name === 'MulterError') {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return badRequest(res, 'Uploaded file is too large.');
    }
    return badRequest(res, error.message || 'Upload error.');
  }

  if (env.nodeEnv !== 'production') {
    console.error(error);
  }

  return serverError(res, 'Something went wrong.');
}
