import { z } from 'zod';
import { Institution } from '../models/Institution.js';
import { User } from '../models/User.js';
import { created, ok } from '../utils/http.js';

const createInstitutionSchema = z.object({
  institutionName: z.string().min(2),
  cityCode: z
    .string()
    .min(2)
    .max(6)
    .optional()
    .transform((value) => (value || 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '')),
  planType: z.enum(['trial', 'paid']).default('trial'),
  trialTeacherLimit: z.number().int().min(1).max(500).default(5),
  trialSubjectLimitPerTeacher: z.number().int().min(1).max(200).default(5),
  studentLimit: z.number().int().min(1).max(200000).default(200),
  adminName: z.string().min(2).default('Institution Admin'),
  adminEmail: z.string().email().optional().or(z.literal('')),
  adminPhone: z.string().optional().or(z.literal('')),
  subscriptionEndsAt: z.string().datetime().optional().or(z.literal(''))
});

function randomDigits(length = 4) {
  let value = '';
  for (let i = 0; i < length; i += 1) {
    value += Math.floor(Math.random() * 10).toString();
  }
  return value;
}

function generatePassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let password = '';
  for (let i = 0; i < length; i += 1) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }
  return password;
}

async function generateInstitutionId(cityCode) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const institutionId = `LIFT-${cityCode}-${randomDigits(4)}`;
    const exists = await Institution.findOne({ institutionId }).select('_id').lean();
    if (!exists) return institutionId;
  }
  throw new Error('Failed to generate unique institution ID.');
}

export async function createInstitution(req, res) {
  const parsed = createInstitutionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid institution payload.' });
  }

  const payload = parsed.data;
  const institutionId = await generateInstitutionId(payload.cityCode);
  const paymentStatus = payload.planType === 'paid' ? 'paid' : 'pending';
  const adminUsername = 'admin';
  const adminPassword = generatePassword();

  const institution = await Institution.create({
    name: payload.institutionName,
    institutionId,
    cityCode: payload.cityCode,
    planType: payload.planType,
    paymentStatus,
    trialTeacherLimit: payload.trialTeacherLimit,
    trialSubjectLimitPerTeacher: payload.trialSubjectLimitPerTeacher,
    studentLimit: payload.studentLimit,
    subscriptionEndsAt: payload.subscriptionEndsAt ? new Date(payload.subscriptionEndsAt) : null,
    isActive: true
  });

  const passwordHash = await User.hashPassword(adminPassword);
  const admin = await User.create({
    institutionId: institution._id,
    role: 'admin',
    username: adminUsername,
    passwordHash,
    fullName: payload.adminName,
    email: payload.adminEmail || '',
    phone: payload.adminPhone || '',
    mustChangePassword: true,
    isActive: true
  });

  return created(
    res,
    {
      institution: {
        id: institution._id,
        name: institution.name,
        institutionId: institution.institutionId,
        planType: institution.planType,
        paymentStatus: institution.paymentStatus
      },
      adminCredentials: {
        username: admin.username,
        temporaryPassword: adminPassword
      }
    },
    'Institution created with admin credentials.'
  );
}

export async function listInstitutions(req, res) {
  const institutions = await Institution.find({})
    .sort({ createdAt: -1 })
    .select(
      'name institutionId cityCode planType paymentStatus trialTeacherLimit trialSubjectLimitPerTeacher studentLimit subscriptionEndsAt isActive createdAt'
    )
    .lean();

  return ok(res, { institutions });
}
