import { Router } from 'express';
import { dashboard, syllabi, testHistory } from '../controllers/student.controller.js';
import { studentListResources } from '../controllers/resource.controller.js';
import {
  studentAttemptAnswerKey,
  studentSubmitAttempt,
  studentTestsQueue
} from '../controllers/test.controller.js';
import {
  studentConversation,
  studentSendMessage,
  studentTeacherList
} from '../controllers/message.controller.js';
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
router.post('/tests/:testId/attempt', studentSubmitAttempt);
router.get('/tests/attempts/:attemptId/answer-key', studentAttemptAnswerKey);
router.get('/resources', studentListResources);
router.get('/syllabus', syllabi);
router.get('/teachers', studentTeacherList);
router.get('/messages', studentConversation);
router.post('/messages', studentSendMessage);
router.get('/notifications', myNotifications);
router.post('/notifications/read', markNotificationsRead);

export { router as studentRouter };
