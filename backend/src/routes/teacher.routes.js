import { Router } from 'express';
import {
  createStudent,
  createSubject,
  deleteStudent,
  deleteSubject,
  listMyStudents,
  listMySubjects,
  updateSubjectSyllabus
} from '../controllers/teacher.controller.js';
import {
  teacherCreateClassPlan,
  teacherDeleteClassPlan,
  teacherListClassPlans
} from '../controllers/classPlan.controller.js';
import {
  teacherCreateResource,
  teacherDeleteResource,
  teacherListResources
} from '../controllers/resource.controller.js';
import {
  teacherGradeAttempt,
  teacherListAssessments,
  teacherCreateTest,
  teacherListTests
} from '../controllers/test.controller.js';
import {
  markNotificationsRead,
  myNotifications
} from '../controllers/notification.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('teacher'));
router.get('/subjects', listMySubjects);
router.post('/subjects', createSubject);
router.patch('/subjects/:subjectId/syllabus', updateSubjectSyllabus);
router.delete('/subjects/:subjectId', deleteSubject);
router.get('/students', listMyStudents);
router.post('/students', createStudent);
router.delete('/students/:studentId', deleteStudent);
router.get('/resources', teacherListResources);
router.post('/resources', teacherCreateResource);
router.delete('/resources/:resourceId', teacherDeleteResource);
router.get('/tests', teacherListTests);
router.post('/tests', teacherCreateTest);
router.get('/assessments', teacherListAssessments);
router.patch('/assessments/:attemptId/grade', teacherGradeAttempt);
router.get('/class-plans', teacherListClassPlans);
router.post('/class-plans', teacherCreateClassPlan);
router.delete('/class-plans/:planId', teacherDeleteClassPlan);
router.get('/notifications', myNotifications);
router.post('/notifications/read', markNotificationsRead);

export { router as teacherRouter };
