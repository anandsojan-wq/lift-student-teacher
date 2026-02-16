import { Router } from 'express';
import {
  createInstitution,
  listInstitutions
} from '../controllers/superAdmin.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth, requireRole('super_admin'));
router.get('/institutions', listInstitutions);
router.post('/institutions', createInstitution);

export { router as superAdminRouter };
