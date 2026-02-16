import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { Institution } from '../models/Institution.js';
import { User } from '../models/User.js';
import { badRequest, created, notFound, ok, unauthorized } from '../utils/http.js';

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
  password: z.string().min(1)
});

const setPasswordFirstTimeSchema = z.object({
  institutionId: z.string().min(1),
  username: z.string().min(1),
  temporaryPassword: z.string().min(1),
  newPassword: z.string().min(6)
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
    fullName: adminName,
    email: adminEmail || ''
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

  const { institutionId, username, password } = parsed.data;
  const institution = await Institution.findOne({ institutionId, isActive: true }).lean();
  if (!institution) return notFound(res, 'Institution not found.');

  const user = await User.findOne({
    institutionId: institution._id,
    username: username.toLowerCase(),
    isActive: true
  });
  if (!user) return unauthorized(res, 'Invalid credentials.');

  const valid = await user.verifyPassword(password);
  if (!valid) return unauthorized(res, 'Invalid credentials.');

  const token = signAccessToken(user);
  return ok(res, {
    token,
    user: {
      id: user._id,
      role: user.role,
      username: user.username,
      fullName: user.fullName,
      mustChangePassword: user.mustChangePassword
    }
  });
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
    institution: institution
      ? {
          id: institution._id,
          name: institution.name,
          institutionId: institution.institutionId
        }
      : null
  });
}

export async function setPasswordFirstTime(req, res) {
  const parsed = setPasswordFirstTimeSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Invalid password setup payload.');

  const { institutionId, username, temporaryPassword, newPassword } = parsed.data;
  const institution = await Institution.findOne({ institutionId, isActive: true }).lean();
  if (!institution) return notFound(res, 'Institution not found.');

  const user = await User.findOne({
    institutionId: institution._id,
    username: username.toLowerCase(),
    isActive: true
  });
  if (!user) return unauthorized(res, 'Invalid credentials.');
  if (user.role !== 'student') {
    return unauthorized(res, 'Only student accounts can use first-time setup.');
  }
  if (!user.mustChangePassword) {
    return badRequest(res, 'Password already set. Use normal login.');
  }

  const valid = await user.verifyPassword(temporaryPassword);
  if (!valid) return unauthorized(res, 'Invalid temporary password.');

  user.passwordHash = await User.hashPassword(newPassword);
  user.mustChangePassword = false;
  await user.save();

  return ok(res, {}, 'Password set successfully. Please login now.');
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
  user.mustChangePassword = false;
  await user.save();

  return ok(res, {}, 'Password updated successfully.');
}
