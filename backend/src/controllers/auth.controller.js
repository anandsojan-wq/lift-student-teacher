import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { Institution } from '../models/Institution.js';
import { User } from '../models/User.js';
import { trackAnalyticsEvent } from '../services/analytics.service.js';
import { badRequest, created, forbidden, notFound, ok, unauthorized } from '../utils/http.js';
import { getInstitutionAccessStatus } from '../utils/institution-access.js';

const bootstrapSchema = z.object({
  institutionName: z.string().min(2),
  institutionId: z.string().min(4),
  adminName: z.string().min(2),
  adminUsername: z.string().min(3),
  adminPassword: z.string().min(6),
  adminEmail: z.string().email().optional().or(z.literal(''))
});

const loginSchema = z.object({
  institutionId: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  rememberMe: z.boolean().optional()
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6)
});

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      institutionId: user.institutionId.toString()
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

function parseDurationMs(value, fallbackMs = 7 * 24 * 60 * 60 * 1000) {
  const input = String(value || '').trim();
  if (!input) return fallbackMs;
  if (/^\d+$/.test(input)) return Number(input) * 1000;

  const match = input.match(/^(\d+)([smhd])$/i);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitMs = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return amount * (unitMs[unit] || fallbackMs);
}

function isSecureRequest(req) {
  if (req.secure) return true;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return forwardedProto.includes('https') || env.nodeEnv === 'production';
}

function authCookieOptions(req, rememberMe = false) {
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/'
  };

  if (rememberMe) {
    options.maxAge = parseDurationMs(env.jwtExpiresIn);
  }

  return options;
}

function clearAuthCookie(req, res) {
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/'
  });
}

function serializeInstitution(institution) {
  if (!institution) return null;
  return {
    id: institution._id,
    name: institution.name,
    institutionId: institution.institutionId,
    branding: {
      logoUrl: institution.branding?.logoUrl || '',
      accentColor: institution.branding?.accentColor || '#2b8be6',
      footerText: institution.branding?.footerText || 'Developed by LIFT Educations'
    }
  };
}

export async function bootstrap(req, res) {
  const parsed = bootstrapSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Invalid bootstrap payload.');

  const {
    institutionName,
    institutionId,
    adminName,
    adminUsername,
    adminPassword,
    adminEmail
  } = parsed.data;

  const existingInstitution = await Institution.findOne({ institutionId }).lean();
  if (existingInstitution) {
    return badRequest(res, 'Institution ID already exists.');
  }

  const institution = await Institution.create({
    name: institutionName,
    institutionId
  });

  const passwordHash = await User.hashPassword(adminPassword);
  const admin = await User.create({
    institutionId: institution._id,
    role: 'admin',
    username: adminUsername.toLowerCase(),
    passwordHash,
    temporaryPassword: adminPassword,
    fullName: adminName,
    email: adminEmail || ''
  });

  await trackAnalyticsEvent({
    institutionId: institution._id,
    userId: admin._id,
    role: 'admin',
    eventType: 'admin_account_created',
    stage: 'onboarding',
    metadata: {
      source: 'bootstrap'
    }
  });

  return created(
    res,
    {
      institution: {
        id: institution._id,
        name: institution.name,
        institutionId: institution.institutionId
      },
      admin: {
        id: admin._id,
        username: admin.username,
        role: admin.role
      }
    },
    'Institution and admin account created.'
  );
}

export async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Invalid login payload.');

  const { institutionId, username, password, rememberMe = false } = parsed.data;
  const institution = await Institution.findOne({ institutionId }).lean();
  if (!institution) return notFound(res, 'Institution not found.');

  if (env.enforceInstitutionAccess) {
    const access = getInstitutionAccessStatus(institution);
    if (!access.allowed) return forbidden(res, access.reason);
  }

  const user = await User.findOne({
    institutionId: institution._id,
    username: username.toLowerCase(),
    isActive: true
  });
  if (!user) {
    await trackAnalyticsEvent({
      institutionId: institution._id,
      role: 'system',
      eventType: 'login_failed',
      stage: 'security',
      metadata: {
        username: username.toLowerCase(),
        reason: 'user_not_found'
      }
    });
    return unauthorized(res, 'Invalid credentials.');
  }

  const valid = await user.verifyPassword(password);
  if (!valid) {
    await trackAnalyticsEvent({
      institutionId: institution._id,
      userId: user._id,
      role: user.role,
      eventType: 'login_failed',
      stage: 'security',
      metadata: {
        username: user.username,
        reason: 'password_mismatch'
      }
    });
    return unauthorized(res, 'Invalid credentials.');
  }

  const token = signAccessToken(user);
  res.cookie('token', token, authCookieOptions(req, rememberMe));

  await trackAnalyticsEvent({
    institutionId: user.institutionId,
    userId: user._id,
    role: user.role,
    eventType: 'login_success',
    stage: 'engagement',
    metadata: {
      institutionCode: institutionId
    }
  });

  return ok(res, {
    user: {
      id: user._id,
      role: user.role,
      username: user.username,
      fullName: user.fullName,
      mustChangePassword: user.mustChangePassword
    },
    institution: serializeInstitution(institution)
  });
}

export async function logout(req, res) {
  clearAuthCookie(req, res);
  return ok(res, {}, 'Signed out successfully.');
}

export async function me(req, res) {
  const user = await User.findById(req.auth.userId).lean();
  if (!user) return unauthorized(res);

  const institution = await Institution.findById(user.institutionId).lean();
  return ok(res, {
    user: {
      id: user._id,
      role: user.role,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      mustChangePassword: user.mustChangePassword
    },
    institution: serializeInstitution(institution)
  });
}

export async function changePassword(req, res) {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Invalid password change payload.');

  const user = await User.findById(req.auth.userId);
  if (!user || !user.isActive) return unauthorized(res);

  const { currentPassword, newPassword } = parsed.data;
  const valid = await user.verifyPassword(currentPassword);
  if (!valid) return unauthorized(res, 'Current password is incorrect.');

  user.passwordHash = await User.hashPassword(newPassword);
  user.temporaryPassword = '';
  user.mustChangePassword = false;
  await user.save();

  await trackAnalyticsEvent({
    institutionId: user.institutionId,
    userId: user._id,
    role: user.role,
    eventType: 'password_changed',
    stage: 'security'
  });

  return ok(res, {}, 'Password updated successfully.');
}
