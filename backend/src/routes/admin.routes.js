import { Router } from 'express';
import {
  createTeacher,
  dashboardSummary,
  listStudents,
  listTeachers
} from '../controllers/admin.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));
router.get('/summary', dashboardSummary);
router.get('/teachers', listTeachers);
router.post('/teachers', createTeacher);
router.get('/students', listStudents);

export { router as adminRouter };
