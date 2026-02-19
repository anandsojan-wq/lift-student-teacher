import { Router } from 'express';
import {
  createTeacher,
  deleteTeacher,
  dashboardSummary,
  listSubjects,
  listStudents,
  listTeachers
} from '../controllers/admin.controller.js';
import { adminAnalytics } from '../controllers/analytics.controller.js';
import { adminAutomationLogs } from '../controllers/automation.controller.js';
import {
  markNotificationsRead,
  myNotifications
} from '../controllers/notification.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));
router.get('/summary', dashboardSummary);
router.get('/analytics', adminAnalytics);
router.get('/automations/logs', adminAutomationLogs);
router.get('/subjects', listSubjects);
router.get('/teachers', listTeachers);
router.post('/teachers', createTeacher);
router.delete('/teachers/:teacherId', deleteTeacher);
router.get('/students', listStudents);
router.get('/notifications', myNotifications);
router.post('/notifications/read', markNotificationsRead);

export { router as adminRouter };
