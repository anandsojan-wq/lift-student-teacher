import { Router } from 'express';
import {
  createSubject,
  createTeacher,
  deleteSubject,
  deleteTeacher,
  dashboardSummary,
  getBranding,
  listSubjects,
  listStudents,
  listTeachers,
  resetTeacherPassword,
  updateBranding,
  updateSubject,
  updateTeacher,
  updateSubjectSyllabus
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
router.get('/branding', getBranding);
router.patch('/branding', updateBranding);
router.get('/analytics', adminAnalytics);
router.get('/automations/logs', adminAutomationLogs);
router.get('/subjects', listSubjects);
router.post('/subjects', createSubject);
router.patch('/subjects/:subjectId', updateSubject);
router.patch('/subjects/:subjectId/syllabus', updateSubjectSyllabus);
router.delete('/subjects/:subjectId', deleteSubject);
router.get('/teachers', listTeachers);
router.post('/teachers', createTeacher);
router.patch('/teachers/:teacherId', updateTeacher);
router.delete('/teachers/:teacherId', deleteTeacher);
router.post('/teachers/:teacherId/reset-password', resetTeacherPassword);
router.get('/students', listStudents);
router.get('/notifications', myNotifications);
router.post('/notifications/read', markNotificationsRead);

export { router as adminRouter };
