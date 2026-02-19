import { z } from 'zod';
import { ClassPlan } from '../models/ClassPlan.js';
import { Resource } from '../models/Resource.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { User } from '../models/User.js';
import { badRequest, created, notFound, ok } from '../utils/http.js';
import { notifyUsers } from '../utils/notify.js';
import { toKeywordArray } from '../utils/text.js';

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function isDataUrl(value) {
  return /^data:[a-z0-9/+.-]+;base64,[a-z0-9+/=\s]+$/i.test(String(value || ''));
}

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const resourceSchema = z
  .object({
    resourceType: z.enum(['pdf', 'ebook', 'video', 'link']),
    title: z.string().trim().min(1).max(200),
    value: z.string().trim().min(1).max(4_500_000),
    source: z.enum(['file', 'text']).default('text'),
    keywords: z.union([z.array(z.string()), z.string()]).optional()
  })
  .superRefine((payload, ctx) => {
    if (payload.source === 'file' && !isDataUrl(payload.value) && !isHttpUrl(payload.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Uploaded resource is invalid. Please upload again.'
      });
    }

    if (payload.source === 'text' && !isHttpUrl(payload.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Resource URL is invalid.'
      });
    }
  });

const createClassPlanSchema = z.object({
  subjectId: z.string().min(1),
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  scheduledDate: z.string().trim().min(1),
  startTime: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((value) => !value || timePattern.test(value), 'Invalid start time. Use HH:MM.'),
  endTime: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((value) => !value || timePattern.test(value), 'Invalid end time. Use HH:MM.'),
  resource: resourceSchema.optional().nullable()
});

function dayRange(dateString) {
  const raw = String(dateString || '').trim();
  const date = raw ? new Date(`${raw}T00:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) return null;

  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  return { start, end };
}

function serializePlan(plan, { subjectMap, teacherMap, resourceMap } = {}) {
  const subject = subjectMap?.get(String(plan.subjectId));
  const teacher = teacherMap?.get(String(plan.teacherId));
  const resource = plan.resourceId ? resourceMap?.get(String(plan.resourceId)) || null : null;

  return {
    id: plan._id,
    subjectId: plan.subjectId,
    subjectName: subject?.name || '',
    teacherId: plan.teacherId,
    teacherName: teacher?.fullName || '',
    title: plan.title,
    description: plan.description || '',
    scheduledDate: plan.scheduledDate,
    startTime: plan.startTime || '',
    endTime: plan.endTime || '',
    resource: resource
      ? {
          id: resource._id,
          title: resource.title,
          resourceType: resource.resourceType,
          value: resource.value,
          source: resource.source
        }
      : null,
    createdAt: plan.createdAt
  };
}

export async function teacherCreateClassPlan(req, res) {
  const parsed = createClassPlanSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message || 'Invalid class plan payload.');
  }

  const payload = parsed.data;
  const range = dayRange(payload.scheduledDate);
  if (!range) return badRequest(res, 'Invalid date. Use YYYY-MM-DD.');

  const subject = await Subject.findOne({
    _id: payload.subjectId,
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  }).lean();
  if (!subject) return notFound(res, 'Subject not found.');

  let createdResource = null;
  if (payload.resource) {
    createdResource = await Resource.create({
      institutionId: req.auth.institutionId,
      teacherId: req.auth.userId,
      subjectId: payload.subjectId,
      resourceType: payload.resource.resourceType,
      title: payload.resource.title,
      value: payload.resource.value,
      source: payload.resource.source,
      keywords: toKeywordArray(payload.resource.keywords || payload.resource.title)
    });
  }

  const plan = await ClassPlan.create({
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId,
    subjectId: payload.subjectId,
    title: payload.title,
    description: payload.description || '',
    scheduledDate: range.start,
    startTime: payload.startTime || '',
    endTime: payload.endTime || '',
    resourceId: createdResource?._id || null
  });

  const profiles = await StudentProfile.find({
    teacherId: req.auth.userId,
    subjects: payload.subjectId
  })
    .select('userId')
    .lean();

  await notifyUsers({
    institutionId: req.auth.institutionId,
    recipientUserIds: profiles.map((item) => item.userId),
    type: 'class_plan',
    message: `New class scheduled: ${payload.title}`
  });

  if (createdResource) {
    await notifyUsers({
      institutionId: req.auth.institutionId,
      recipientUserIds: profiles.map((item) => item.userId),
      type: 'resource',
      message: `New ${createdResource.resourceType.toUpperCase()} resource added: ${createdResource.title}`
    });
  }

  return created(
    res,
    {
      plan: serializePlan(plan, {
        subjectMap: new Map([[String(subject._id), subject]]),
        teacherMap: new Map(),
        resourceMap: createdResource ? new Map([[String(createdResource._id), createdResource]]) : new Map()
      }),
      resource: createdResource
    },
    'Class plan created.'
  );
}

export async function teacherListClassPlans(req, res) {
  const range = dayRange(req.query.date);
  if (!range) return badRequest(res, 'Invalid date. Use YYYY-MM-DD.');

  const plans = await ClassPlan.find({
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId,
    scheduledDate: { $gte: range.start, $lte: range.end }
  })
    .sort({ startTime: 1, createdAt: -1 })
    .lean();

  const [subjects, resources] = await Promise.all([
    Subject.find({ _id: { $in: plans.map((plan) => plan.subjectId) } })
      .select('name')
      .lean(),
    Resource.find({ _id: { $in: plans.map((plan) => plan.resourceId).filter(Boolean) } })
      .select('title resourceType value source')
      .lean()
  ]);

  const subjectMap = new Map(subjects.map((subject) => [String(subject._id), subject]));
  const resourceMap = new Map(resources.map((resource) => [String(resource._id), resource]));

  return ok(res, {
    plans: plans.map((plan) => serializePlan(plan, { subjectMap, resourceMap })),
    date: range.start.toISOString().slice(0, 10)
  });
}

export async function teacherDeleteClassPlan(req, res) {
  const plan = await ClassPlan.findOne({
    _id: req.params.planId,
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  });
  if (!plan) return notFound(res, 'Class plan not found.');

  await plan.deleteOne();
  return ok(res, {}, 'Class plan deleted.');
}

export async function studentTodayClasses(req, res) {
  const profile = await StudentProfile.findOne({ userId: req.auth.userId })
    .select('subjects teacherId')
    .lean();
  if (!profile?.subjects?.length) return ok(res, { classes: [] });

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const plans = await ClassPlan.find({
    institutionId: req.auth.institutionId,
    subjectId: { $in: profile.subjects },
    ...(profile.teacherId ? { teacherId: profile.teacherId } : {}),
    scheduledDate: { $gte: start, $lte: end }
  })
    .sort({ startTime: 1, createdAt: 1 })
    .lean();

  if (!plans.length) return ok(res, { classes: [] });

  const [subjects, teachers, resources] = await Promise.all([
    Subject.find({ _id: { $in: plans.map((plan) => plan.subjectId) } })
      .select('name')
      .lean(),
    User.find({ _id: { $in: plans.map((plan) => plan.teacherId) } })
      .select('fullName')
      .lean(),
    Resource.find({ _id: { $in: plans.map((plan) => plan.resourceId).filter(Boolean) } })
      .select('title resourceType value source')
      .lean()
  ]);

  const subjectMap = new Map(subjects.map((subject) => [String(subject._id), subject]));
  const teacherMap = new Map(teachers.map((teacher) => [String(teacher._id), teacher]));
  const resourceMap = new Map(resources.map((resource) => [String(resource._id), resource]));

  return ok(res, {
    classes: plans.map((plan) => serializePlan(plan, { subjectMap, teacherMap, resourceMap }))
  });
}
