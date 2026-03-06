import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { createRateLimit } from './middlewares/rate-limit.js';
import { attachRequestContext } from './middlewares/request-context.js';
import { errorHandler, notFoundHandler } from './middlewares/error.js';
import { apiRouter } from './routes/index.js';

export function buildApp() {
  const app = express();
  const localOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
  const vercelOriginPattern = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(attachRequestContext);
  app.use(helmet());
  morgan.token('reqId', (req) => req.requestId || '-');
  const morganFormat =
    env.nodeEnv === 'production'
      ? ':remote-addr :method :url :status :res[content-length] - :response-time ms reqId=:reqId'
      : ':method :url :status :response-time ms reqId=:reqId';

  const globalRateLimit = createRateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.rateLimitMax,
    namespace: 'api-global',
    skip: (req) => req.path === '/api/health' || req.path === '/api/ready'
  });
  const authRateLimit = createRateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.authRateLimitMax,
    namespace: 'auth-login',
    keyFn: (req) => `${req.ip || 'unknown'}:${(req.body?.username || '').toString().toLowerCase()}`,
    message: 'Too many login attempts. Please try again later.'
  });
  const writeRateLimit = createRateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.writeRateLimitMax,
    namespace: 'write-heavy',
    skip: (req) =>
      ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
      req.path === '/auth/login'
  });

  app.use(globalRateLimit);
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
  app.use(express.json({ limit: `${env.uploadMaxMb}mb` }));
  app.use(cookieParser());
  app.use(morgan(morganFormat));
  app.use('/api/auth/login', authRateLimit);
  app.use('/api', writeRateLimit);

  app.get('/', (req, res) => {
    res.status(200).json({
      success: true,
      requestId: req.requestId,
      message: 'LIFT backend is running. Use /api/health to verify.'
    });
  });

  app.use('/api', apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
