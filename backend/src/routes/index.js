import { Router } from 'express';
import { getDbStatus } from '../config/db.js';
import { adminRouter } from './admin.routes.js';
import { authRouter } from './auth.routes.js';
import { studentRouter } from './student.routes.js';
import { superAdminRouter } from './super-admin.routes.js';
import { teacherRouter } from './teacher.routes.js';

const router = Router();

router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API healthy',
    data: {
      uptimeSeconds: Math.round(process.uptime()),
      db: getDbStatus()
    }
  });
});

router.use('/auth', authRouter);
router.use('/super-admin', superAdminRouter);
router.use('/admin', adminRouter);
router.use('/teacher', teacherRouter);
router.use('/student', studentRouter);

export { router as apiRouter };
