import { Router } from 'express';
import {
  bootstrap,
  changePassword,
  login,
  me
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

router.post('/bootstrap', bootstrap);
router.post('/login', login);
router.get('/me', requireAuth, me);
router.post('/change-password', requireAuth, changePassword);

export { router as authRouter };
