import { Router } from 'express';
import { getDbStatus } from '../config/db.js';
import { env } from '../config/env.js';
import { adminRouter } from './admin.routes.js';
import { authRouter } from './auth.routes.js';
import { studentRouter } from './student.routes.js';
import { superAdminRouter } from './super-admin.routes.js';
import { teacherRouter } from './teacher.routes.js';
import { uploadRouter } from './upload.routes.js';

const router = Router();

router.get('/health', (req, res) => {
  const db = getDbStatus();
  res.status(200).json({
    success: true,
    message: 'API healthy',
    requestId: req.requestId,
    data: {
      environment: env.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      db
    }
  });
});

router.get('/ready', (req, res) => {
  const db = getDbStatus();
  const ready = db === 'connected';
  res.status(ready ? 200 : 503).json({
    success: ready,
    message: ready ? 'API ready' : 'API not ready',
    requestId: req.requestId,
    data: {
      environment: env.nodeEnv,
      db
    }
  });
});

router.use('/auth', authRouter);
router.use('/super-admin', superAdminRouter);
router.use('/admin', adminRouter);
router.use('/teacher', teacherRouter);
router.use('/student', studentRouter);
router.use('/uploads', uploadRouter);

export { router as apiRouter };
