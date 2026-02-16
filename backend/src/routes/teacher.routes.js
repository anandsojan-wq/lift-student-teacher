import { Router } from 'express';
import {
  createStudent,
  createSubject,
  deleteStudent,
  deleteSubject,
  listMyStudents,
  listMySubjects
} from '../controllers/teacher.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('teacher'));
router.get('/subjects', listMySubjects);
router.post('/subjects', createSubject);
router.delete('/subjects/:subjectId', deleteSubject);
router.get('/students', listMyStudents);
router.post('/students', createStudent);
router.delete('/students/:studentId', deleteStudent);

export { router as teacherRouter };
