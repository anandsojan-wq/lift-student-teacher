import { Router } from 'express';
import {
  createStudent,
  createSubject,
  deleteStudent,
  deleteSubject,
  listMyStudents,
  listMySubjects
} from '../controllers/teacher.controller.js';
import {
  teacherCreateResource,
  teacherDeleteResource,
  teacherListResources
} from '../controllers/resource.controller.js';
import {
  teacherCreateTest,
  teacherListTests
} from '../controllers/test.controller.js';
import {
  teacherConversation,
  teacherSendMessage
} from '../controllers/message.controller.js';
import {
  markNotificationsRead,
  myNotifications
} from '../controllers/notification.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('teacher'));
router.get('/subjects', listMySubjects);
router.post('/subjects', createSubject);
router.delete('/subjects/:subjectId', deleteSubject);
router.get('/students', listMyStudents);
router.post('/students', createStudent);
router.delete('/students/:studentId', deleteStudent);
router.get('/resources', teacherListResources);
router.post('/resources', teacherCreateResource);
router.delete('/resources/:resourceId', teacherDeleteResource);
router.get('/tests', teacherListTests);
router.post('/tests', teacherCreateTest);
router.get('/messages', teacherConversation);
router.post('/messages', teacherSendMessage);
router.get('/notifications', myNotifications);
router.post('/notifications/read', markNotificationsRead);

export { router as teacherRouter };
