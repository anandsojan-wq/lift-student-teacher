import { z } from 'zod';
import { env } from '../config/env.js';
import { AnalyticsEvent } from '../models/AnalyticsEvent.js';
import { Attempt } from '../models/Attempt.js';
import { AutomationLog } from '../models/AutomationLog.js';
import { ClassPlan } from '../models/ClassPlan.js';
import { Institution } from '../models/Institution.js';
import { Message } from '../models/Message.js';
import { Notification } from '../models/Notification.js';
import { Resource } from '../models/Resource.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { Test } from '../models/Test.js';
import { User } from '../models/User.js';
import { trackAnalyticsEvent } from '../services/analytics.service.js';
import { triggerAutomation } from '../services/automation.service.js';
import { badRequest, created, notFound, ok } from '../utils/http.js';

const subscriptionDateSchema = z
  .union([z.string().trim(), z.literal(''), z.null()])
  .refine((value) => value === '' || value === null || !Number.isNaN(Date.parse(value)), {
    message: 'Invalid subscription end date.'
  });

const createInstitutionSchema = z.object({
  institutionName: z
    .string()
    .trim()
    .min(2, 'Institution name must be at least 2 characters.'),
  cityCode: z
    .preprocess(
      (value) => {
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        return trimmed || undefined;
      },
      z
        .string()
        .min(1, 'City code must be at least 1 character.')
        .max(6, 'City code can have maximum 6 characters.')
        .regex(/^[A-Za-z0-9]+$/, 'City code must contain only letters and numbers.')
        .optional()
    )
    .transform((value) => {
      const cleaned = (value || 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      return cleaned || 'GEN';
    }),
  planType: z.enum(['trial', 'paid']).default('trial'),
  subscriptionLength: z.enum(['6_months', '1_year', 'lifetime']).default('1_year'),
  trialTeacherLimit: z
    .coerce
    .number()
    .int()
    .min(1, 'Teacher limit must be at least 1.')
    .max(10000, 'Teacher limit must be 10000 or less.')
    .default(5),
  trialSubjectLimitPerTeacher: z
    .coerce
    .number()
    .int()
    .min(1, 'Subjects-per-teacher limit must be at least 1.')
    .max(10000, 'Subjects-per-teacher limit must be 10000 or less.')
    .default(5),
  studentLimit: z
    .coerce
    .number()
    .int()
    .min(1, 'Student limit must be at least 1.')
    .max(2000000, 'Student limit is too high.')
    .default(200),
  adminName: z
    .preprocess(
      (value) => {
        if (typeof value !== 'string') return 'Institution Admin';
        const trimmed = value.trim();
        return trimmed || 'Institution Admin';
      },
      z.string().min(2, 'Admin name must be at least 2 characters.')
    )
    .default('Institution Admin'),
  adminEmail: z.string().email().optional().or(z.literal('')),
  adminPhone: z.string().optional().or(z.literal('')),
  subscriptionEndsAt: subscriptionDateSchema.optional()
});

const updateInstitutionSchema = z
  .object({
    planType: z.enum(['trial', 'paid']).optional(),
    subscriptionLength: z.enum(['6_months', '1_year', 'lifetime']).optional(),
    paymentStatus: z.enum(['pending', 'paid', 'cancelled']).optional(),
    trialTeacherLimit: z.coerce.number().int().min(1).max(10000).optional(),
    trialSubjectLimitPerTeacher: z.coerce.number().int().min(1).max(10000).optional(),
    studentLimit: z.coerce.number().int().min(1).max(2000000).optional(),
    isActive: z.boolean().optional(),
    subscriptionEndsAt: subscriptionDateSchema.optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'At least one field is required.'
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

function computeSubscriptionEndsAt(subscriptionLength, fromDate = new Date()) {
  const normalized = String(subscriptionLength || '').trim().toLowerCase();
  if (normalized === 'lifetime') return null;

  const base = new Date(fromDate);
  if (Number.isNaN(base.getTime())) return null;

  if (normalized === '6_months') {
    base.setMonth(base.getMonth() + 6);
    return base;
  }

  base.setFullYear(base.getFullYear() + 1);
  return base;
}

async function generateInstitutionId(cityCode) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const institutionId = `LIFT-${cityCode}-${randomDigits(4)}`;
    const exists = await Institution.findOne({ institutionId }).select('_id').lean();
    if (!exists) return institutionId;
  }
  throw new Error('Failed to generate unique institution ID.');
}

function serializeInstitution(institution, counts = {}) {
  return {
    id: institution._id,
    name: institution.name,
    institutionId: institution.institutionId,
    cityCode: institution.cityCode,
    planType: institution.planType,
    subscriptionLength: institution.subscriptionLength || '1_year',
    paymentStatus: institution.paymentStatus,
    trialTeacherLimit: institution.trialTeacherLimit,
    trialSubjectLimitPerTeacher: institution.trialSubjectLimitPerTeacher,
    studentLimit: institution.studentLimit,
    adminCredentials: {
      username: institution.adminCredentials?.username || 'admin',
      temporaryPassword: institution.adminCredentials?.temporaryPassword || '',
      issuedAt: institution.adminCredentials?.issuedAt || null
    },
    subscriptionEndsAt: institution.subscriptionEndsAt,
    isActive: institution.isActive,
    createdAt: institution.createdAt,
    teacherCount: counts.teacherCount || 0,
    studentCount: counts.studentCount || 0,
    subjectCount: counts.subjectCount || 0
  };
}

async function buildCountsMap() {
  const [teachers, students, subjects] = await Promise.all([
    User.aggregate([
      { $match: { role: 'teacher', isActive: true } },
      { $group: { _id: '$institutionId', count: { $sum: 1 } } }
    ]),
    User.aggregate([
      { $match: { role: 'student', isActive: true } },
      { $group: { _id: '$institutionId', count: { $sum: 1 } } }
    ]),
    Subject.aggregate([{ $group: { _id: '$institutionId', count: { $sum: 1 } } }])
  ]);

  const map = new Map();
  for (const item of teachers) {
    map.set(String(item._id), { teacherCount: item.count, studentCount: 0, subjectCount: 0 });
  }
  for (const item of students) {
    const key = String(item._id);
    const current = map.get(key) || { teacherCount: 0, studentCount: 0, subjectCount: 0 };
    current.studentCount = item.count;
    map.set(key, current);
  }
  for (const item of subjects) {
    const key = String(item._id);
    const current = map.get(key) || { teacherCount: 0, studentCount: 0, subjectCount: 0 };
    current.subjectCount = item.count;
    map.set(key, current);
  }

  return map;
}

function protectOwnerInstitution(institutionId, payload = {}) {
  if (institutionId !== env.superAdminInstitutionId) return null;
  if (payload.paymentStatus === 'cancelled') {
    return 'Owner HQ subscription cannot be cancelled.';
  }
  if (payload.isActive === false) {
    return 'Owner HQ institution cannot be deactivated.';
  }
  return null;
}

export async function createInstitution(req, res) {
  const parsed = createInstitutionSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message || 'Invalid institution payload.');
  }

  const payload = parsed.data;
  const institutionId = await generateInstitutionId(payload.cityCode);
  const paymentStatus = payload.planType === 'paid' ? 'paid' : 'pending';
  const adminUsername = 'admin';
  const adminPassword = generatePassword();
  const subscriptionEndsAt =
    payload.subscriptionLength === 'lifetime'
      ? null
      : payload.subscriptionEndsAt
        ? new Date(payload.subscriptionEndsAt)
        : computeSubscriptionEndsAt(payload.subscriptionLength);

  const institution = await Institution.create({
    name: payload.institutionName,
    institutionId,
    cityCode: payload.cityCode,
    planType: payload.planType,
    subscriptionLength: payload.subscriptionLength,
    paymentStatus,
    trialTeacherLimit: payload.trialTeacherLimit,
    trialSubjectLimitPerTeacher: payload.trialSubjectLimitPerTeacher,
    studentLimit: payload.studentLimit,
    adminCredentials: {
      username: adminUsername,
      temporaryPassword: adminPassword,
      issuedAt: new Date()
    },
    subscriptionEndsAt,
    isActive: true
  });

  const passwordHash = await User.hashPassword(adminPassword);
  const admin = await User.create({
    institutionId: institution._id,
    role: 'admin',
    username: adminUsername,
    passwordHash,
    temporaryPassword: adminPassword,
    fullName: payload.adminName,
    email: payload.adminEmail || '',
    phone: payload.adminPhone || '',
    mustChangePassword: false,
    isActive: true
  });

  await trackAnalyticsEvent({
    institutionId: institution._id,
    userId: req.auth.userId,
    role: 'super_admin',
    eventType: 'institution_created',
    stage: 'onboarding',
    metadata: {
      institutionName: institution.name,
      institutionId: institution.institutionId,
      planType: institution.planType
    }
  });
  await trackAnalyticsEvent({
    institutionId: institution._id,
    userId: admin._id,
    role: 'admin',
    eventType: 'admin_account_created',
    stage: 'onboarding',
    metadata: {
      username: admin.username
    }
  });

  await triggerAutomation({
    eventType: 'onboarding.new_institution',
    institutionId: institution._id,
    triggerRole: 'super_admin',
    payload: {
      institution: {
        name: institution.name,
        institutionId: institution.institutionId,
        planType: institution.planType,
        subscriptionLength: institution.subscriptionLength,
        paymentStatus: institution.paymentStatus
      },
      admin: {
        fullName: admin.fullName,
        username: admin.username,
        email: admin.email,
        phone: admin.phone,
        temporaryPassword: adminPassword
      }
    }
  });

  return created(
    res,
    {
      institution: serializeInstitution(institution),
      adminCredentials: {
        username: admin.username,
        temporaryPassword: adminPassword
      }
    },
    'Institution created with admin credentials.'
  );
}

export async function purgeCancelledInstitutions(req, res) {
  const dryRun = String(req.query?.dryRun || '')
    .trim()
    .toLowerCase() === 'true';

  const cancelled = await Institution.find({
    paymentStatus: 'cancelled',
    institutionId: { $ne: env.superAdminInstitutionId }
  })
    .select('_id institutionId name')
    .lean();

  if (!cancelled.length) {
    return ok(
      res,
      {
        purgedCount: 0,
        purgedInstitutions: [],
        deleted: {},
        dryRun
      },
      'No cancelled subscriptions found.'
    );
  }

  if (dryRun) {
    return ok(
      res,
      {
        purgedCount: cancelled.length,
        purgedInstitutions: cancelled.map((item) => ({
          id: item._id,
          institutionId: item.institutionId,
          name: item.name
        })),
        deleted: {},
        dryRun: true
      },
      `Dry run: ${cancelled.length} cancelled subscription(s) ready for deletion.`
    );
  }

  const institutionObjectIds = cancelled.map((item) => item._id);
  const users = await User.find({
    institutionId: { $in: institutionObjectIds }
  })
    .select('_id')
    .lean();
  const userIds = users.map((item) => item._id);

  const [
    usersResult,
    subjectsResult,
    resourcesResult,
    testsResult,
    attemptsResult,
    messagesResult,
    notificationsResult,
    analyticsResult,
    automationResult,
    classPlansResult,
    studentProfilesResult,
    institutionsResult
  ] = await Promise.all([
    User.deleteMany({ institutionId: { $in: institutionObjectIds } }),
    Subject.deleteMany({ institutionId: { $in: institutionObjectIds } }),
    Resource.deleteMany({ institutionId: { $in: institutionObjectIds } }),
    Test.deleteMany({ institutionId: { $in: institutionObjectIds } }),
    Attempt.deleteMany({ institutionId: { $in: institutionObjectIds } }),
    Message.deleteMany({ institutionId: { $in: institutionObjectIds } }),
    Notification.deleteMany({ institutionId: { $in: institutionObjectIds } }),
    AnalyticsEvent.deleteMany({ institutionId: { $in: institutionObjectIds } }),
    AutomationLog.deleteMany({ institutionId: { $in: institutionObjectIds } }),
    ClassPlan.deleteMany({ institutionId: { $in: institutionObjectIds } }),
    userIds.length
      ? StudentProfile.deleteMany({
          $or: [{ userId: { $in: userIds } }, { teacherId: { $in: userIds } }]
        })
      : Promise.resolve({ deletedCount: 0 }),
    Institution.deleteMany({ _id: { $in: institutionObjectIds } })
  ]);

  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: req.auth.userId,
    role: 'super_admin',
    eventType: 'cancelled_institutions_deleted',
    stage: 'ops',
    metadata: {
      purgedCount: cancelled.length,
      institutionIds: cancelled.map((item) => item.institutionId)
    }
  });

  return ok(
    res,
    {
      purgedCount: cancelled.length,
      purgedInstitutions: cancelled.map((item) => ({
        id: item._id,
        institutionId: item.institutionId,
        name: item.name
      })),
      deleted: {
        institutions: institutionsResult.deletedCount || 0,
        users: usersResult.deletedCount || 0,
        subjects: subjectsResult.deletedCount || 0,
        resources: resourcesResult.deletedCount || 0,
        tests: testsResult.deletedCount || 0,
        attempts: attemptsResult.deletedCount || 0,
        messages: messagesResult.deletedCount || 0,
        notifications: notificationsResult.deletedCount || 0,
        analyticsEvents: analyticsResult.deletedCount || 0,
        automationLogs: automationResult.deletedCount || 0,
        classPlans: classPlansResult.deletedCount || 0,
        studentProfiles: studentProfilesResult.deletedCount || 0
      },
      dryRun: false
    },
    `Deleted ${cancelled.length} cancelled subscription(s).`
  );
}

export async function listInstitutions(req, res) {
  const [institutions, countsMap] = await Promise.all([
    Institution.find({})
      .sort({ createdAt: -1 })
      .select(
        'name institutionId cityCode planType subscriptionLength paymentStatus trialTeacherLimit trialSubjectLimitPerTeacher studentLimit adminCredentials subscriptionEndsAt isActive createdAt'
      )
      .lean(),
    buildCountsMap()
  ]);

  const formatted = institutions.map((institution) =>
    serializeInstitution(institution, countsMap.get(String(institution._id)))
  );

  return ok(res, { institutions: formatted });
}

export async function superAdminSummary(req, res) {
  const [
    totalInstitutions,
    activeInstitutions,
    paidInstitutions,
    cancelledInstitutions,
    pendingInstitutions,
    totalTeachers,
    totalStudents,
    totalSubjects
  ] = await Promise.all([
    Institution.countDocuments({}),
    Institution.countDocuments({ isActive: true }),
    Institution.countDocuments({ paymentStatus: 'paid' }),
    Institution.countDocuments({ paymentStatus: 'cancelled' }),
    Institution.countDocuments({ paymentStatus: 'pending' }),
    User.countDocuments({ role: 'teacher', isActive: true }),
    User.countDocuments({ role: 'student', isActive: true }),
    Subject.countDocuments({})
  ]);

  return ok(res, {
    totalInstitutions,
    activeInstitutions,
    paidInstitutions,
    cancelledInstitutions,
    pendingInstitutions,
    totalTeachers,
    totalStudents,
    totalSubjects
  });
}

export async function updateInstitution(req, res) {
  const parsed = updateInstitutionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message || 'Invalid update payload.');
  }

  const { institutionId } = req.params;
  const payload = parsed.data;
  const protectedMessage = protectOwnerInstitution(institutionId, payload);
  if (protectedMessage) return badRequest(res, protectedMessage);

  const institution = await Institution.findOne({ institutionId });
  if (!institution) return notFound(res, 'Institution not found.');

  if (payload.planType !== undefined) institution.planType = payload.planType;
  if (payload.subscriptionLength !== undefined) {
    institution.subscriptionLength = payload.subscriptionLength;
    if (payload.subscriptionLength === 'lifetime' && payload.subscriptionEndsAt === undefined) {
      institution.subscriptionEndsAt = null;
    } else if (payload.subscriptionEndsAt === undefined) {
      institution.subscriptionEndsAt = computeSubscriptionEndsAt(payload.subscriptionLength);
    }
  }
  if (payload.paymentStatus !== undefined) institution.paymentStatus = payload.paymentStatus;
  if (payload.trialTeacherLimit !== undefined) institution.trialTeacherLimit = payload.trialTeacherLimit;
  if (payload.trialSubjectLimitPerTeacher !== undefined) {
    institution.trialSubjectLimitPerTeacher = payload.trialSubjectLimitPerTeacher;
  }
  if (payload.studentLimit !== undefined) institution.studentLimit = payload.studentLimit;
  if (payload.isActive !== undefined) institution.isActive = payload.isActive;
  if (payload.subscriptionEndsAt !== undefined) {
    institution.subscriptionEndsAt = payload.subscriptionEndsAt ? new Date(payload.subscriptionEndsAt) : null;
  }

  if (institution.paymentStatus === 'cancelled') {
    institution.isActive = false;
    if (!institution.subscriptionEndsAt) institution.subscriptionEndsAt = new Date();
  }

  await institution.save();

  await trackAnalyticsEvent({
    institutionId: institution._id,
    userId: req.auth.userId,
    role: 'super_admin',
    eventType: 'institution_updated',
    stage: 'ops',
    metadata: {
      institutionId: institution.institutionId,
      changes: Object.keys(payload)
    }
  });

  const [teacherCount, studentCount, subjectCount] = await Promise.all([
    User.countDocuments({ institutionId: institution._id, role: 'teacher', isActive: true }),
    User.countDocuments({ institutionId: institution._id, role: 'student', isActive: true }),
    Subject.countDocuments({ institutionId: institution._id })
  ]);

  return ok(
    res,
    {
      institution: serializeInstitution(institution, {
        teacherCount,
        studentCount,
        subjectCount
      })
    },
    'Institution updated successfully.'
  );
}

export async function cancelInstitutionSubscription(req, res) {
  const { institutionId } = req.params;
  const protectedMessage = protectOwnerInstitution(institutionId, { paymentStatus: 'cancelled' });
  if (protectedMessage) return badRequest(res, protectedMessage);

  const institution = await Institution.findOne({ institutionId });
  if (!institution) return notFound(res, 'Institution not found.');

  institution.paymentStatus = 'cancelled';
  institution.isActive = false;
  institution.subscriptionEndsAt = new Date();
  await institution.save();

  await trackAnalyticsEvent({
    institutionId: institution._id,
    userId: req.auth.userId,
    role: 'super_admin',
    eventType: 'subscription_cancelled',
    stage: 'billing',
    metadata: {
      institutionId: institution.institutionId
    }
  });

  return ok(
    res,
    {
      institution: serializeInstitution(institution)
    },
    'Subscription cancelled and institution access disabled.'
  );
}

export async function resetInstitutionAdminPassword(req, res) {
  const { institutionId } = req.params;
  if (institutionId === env.superAdminInstitutionId) {
    return badRequest(res, 'Owner HQ credentials cannot be reset from this action.');
  }

  const institution = await Institution.findOne({ institutionId });
  if (!institution) return notFound(res, 'Institution not found.');

  const admin = await User.findOne({
    institutionId: institution._id,
    role: 'admin',
    isActive: true
  });
  if (!admin) return notFound(res, 'Admin account not found for this institution.');

  const nextPassword = generatePassword();
  admin.passwordHash = await User.hashPassword(nextPassword);
  admin.temporaryPassword = nextPassword;
  admin.mustChangePassword = false;
  await admin.save();

  institution.adminCredentials = {
    username: admin.username,
    temporaryPassword: nextPassword,
    issuedAt: new Date()
  };
  await institution.save();

  await trackAnalyticsEvent({
    institutionId: institution._id,
    userId: req.auth.userId,
    role: 'super_admin',
    eventType: 'institution_admin_password_reset',
    stage: 'security',
    metadata: {
      institutionId: institution.institutionId,
      adminUserId: admin._id.toString()
    }
  });

  return ok(
    res,
    {
      institution: serializeInstitution(institution),
      adminCredentials: {
        username: admin.username,
        temporaryPassword: nextPassword
      }
    },
    'Admin temporary password reset successfully.'
  );
}
