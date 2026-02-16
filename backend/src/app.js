import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middlewares/error.js';
import { apiRouter } from './routes/index.js';

export function buildApp() {
  const app = express();
  const localOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
  const vercelOriginPattern = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (env.corsOrigins.includes(origin)) return callback(null, true);
        if (localOriginPattern.test(origin)) return callback(null, true);
        if (vercelOriginPattern.test(origin)) return callback(null, true);
        return callback(new Error('CORS not allowed'));
      },
      credentials: true
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.get('/', (req, res) => {
    res.status(200).json({
      success: true,
      message: 'LIFT backend is running. Use /api/health to verify.'
    });
  });

  app.use('/api', apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
