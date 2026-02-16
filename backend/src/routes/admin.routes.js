import { Router } from 'express';
import {
  createTeacher,
  dashboardSummary,
  listSubjects,
  listStudents,
  listTeachers
} from '../controllers/admin.controller.js';
import {
  adminConversation,
  adminSendMessage,
  adminUserList
} from '../controllers/message.controller.js';
import {
  markNotificationsRead,
  myNotifications
} from '../controllers/notification.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));
router.get('/summary', dashboardSummary);
router.get('/subjects', listSubjects);
router.get('/teachers', listTeachers);
router.post('/teachers', createTeacher);
router.get('/students', listStudents);
router.get('/users', adminUserList);
router.get('/messages', adminConversation);
router.post('/messages', adminSendMessage);
router.get('/notifications', myNotifications);
router.post('/notifications/read', markNotificationsRead);

export { router as adminRouter };
