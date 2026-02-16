import { Router } from 'express';
import { dashboard, testHistory } from '../controllers/student.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('student'));
router.get('/dashboard', dashboard);
router.get('/tests/history', testHistory);

export { router as studentRouter };
