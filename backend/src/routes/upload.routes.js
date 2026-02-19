import { Router } from 'express';
import { uploadFile, uploadSingleFile } from '../controllers/upload.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('super_admin', 'admin', 'teacher', 'student'));
router.post('/', uploadSingleFile, uploadFile);

export { router as uploadRouter };
