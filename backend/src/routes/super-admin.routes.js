import { Router } from 'express';
import {
  superAdminGlobalAnalytics,
  superAdminInstitutionAnalytics
} from '../controllers/analytics.controller.js';
import { superAdminAutomationLogs } from '../controllers/automation.controller.js';
import {
  cancelInstitutionSubscription,
  createInstitution,
  listInstitutions,
  purgeCancelledInstitutions,
  resetInstitutionAdminPassword,
  superAdminSummary,
  updateInstitution
} from '../controllers/superAdmin.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('super_admin'));
router.get('/summary', superAdminSummary);
router.get('/analytics', superAdminGlobalAnalytics);
router.get('/analytics/:institutionId', superAdminInstitutionAnalytics);
router.get('/automations/logs', superAdminAutomationLogs);
router.get('/institutions', listInstitutions);
router.post('/institutions', createInstitution);
router.delete('/institutions/purge-cancelled', purgeCancelledInstitutions);
router.patch('/institutions/:institutionId', updateInstitution);
router.post('/institutions/:institutionId/cancel-subscription', cancelInstitutionSubscription);
router.post('/institutions/:institutionId/reset-admin-password', resetInstitutionAdminPassword);

export { router as superAdminRouter };
