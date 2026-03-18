import { Router } from 'express';
import {
  createStudent,
  deleteStudent,
  listMyStudents,
  listMySubjects,
  teacherViewSyllabus
} from '../controllers/teacher.controller.js';
import {
  teacherCreateClassPlan,
  teacherDeleteClassPlan,
  teacherListClassPlans
} from '../controllers/classPlan.controller.js';
import {
  teacherCreateResource,
  teacherDeleteResource,
  teacherListResources,
  teacherTrashResource,
  teacherViewResource
} from '../controllers/resource.controller.js';
import {
  teacherArchiveTest,
  teacherDeleteTest,
  teacherGradeAttempt,
  teacherLiveTestsStats,
  teacherListAssessments,
  teacherCreateTest,
  teacherListTests
  ,
  teacherTrashTest
} from '../controllers/test.controller.js';
import {
  markNotificationsRead,
  myNotifications
} from '../controllers/notification.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('teacher'));
router.get('/subjects', listMySubjects);
router.get('/subjects/:subjectId/syllabus/view', teacherViewSyllabus);
router.get('/students', listMyStudents);
router.post('/students', createStudent);
router.delete('/students/:studentId', deleteStudent);
router.get('/resources', teacherListResources);
router.get('/resources/:resourceId/view', teacherViewResource);
router.post('/resources', teacherCreateResource);
router.patch('/resources/:resourceId/trash', teacherTrashResource);
router.delete('/resources/:resourceId', teacherDeleteResource);
router.get('/tests', teacherListTests);
router.get('/tests/live-stats', teacherLiveTestsStats);
router.post('/tests', teacherCreateTest);
router.patch('/tests/:testId/archive', teacherArchiveTest);
router.patch('/tests/:testId/trash', teacherTrashTest);
router.delete('/tests/:testId', teacherDeleteTest);
router.get('/assessments', teacherListAssessments);
router.patch('/assessments/:attemptId/grade', teacherGradeAttempt);
router.get('/class-plans', teacherListClassPlans);
router.post('/class-plans', teacherCreateClassPlan);
router.delete('/class-plans/:planId', teacherDeleteClassPlan);
router.get('/notifications', myNotifications);
router.post('/notifications/read', markNotificationsRead);

export { router as teacherRouter };
