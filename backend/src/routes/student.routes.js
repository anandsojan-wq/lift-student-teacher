import { Router } from 'express';
import {
  dashboard,
  studentViewSyllabus,
  syllabi,
  testHistory
} from '../controllers/student.controller.js';
import { studentTodayClasses } from '../controllers/classPlan.controller.js';
import {
  studentListResources,
  studentViewResource
} from '../controllers/resource.controller.js';
import {
  studentAttemptAnswerKey,
  studentSubmitAttempt,
  studentTestsQueue
} from '../controllers/test.controller.js';
import {
  markNotificationsRead,
  myNotifications
} from '../controllers/notification.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('student'));
router.get('/dashboard', dashboard);
router.get('/tests/history', testHistory);
router.get('/tests/queue', studentTestsQueue);
router.get('/classes/today', studentTodayClasses);
router.post('/tests/:testId/attempt', studentSubmitAttempt);
router.get('/tests/attempts/:attemptId/answer-key', studentAttemptAnswerKey);
router.get('/resources', studentListResources);
router.get('/resources/:resourceId/view', studentViewResource);
router.get('/syllabus', syllabi);
router.get('/syllabus/:subjectId/view', studentViewSyllabus);
router.get('/notifications', myNotifications);
router.post('/notifications/read', markNotificationsRead);

export { router as studentRouter };
