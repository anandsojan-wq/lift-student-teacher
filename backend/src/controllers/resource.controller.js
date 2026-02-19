import { z } from 'zod';
import { Resource } from '../models/Resource.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { User } from '../models/User.js';
import { trackAnalyticsEvent } from '../services/analytics.service.js';
import { badRequest, created, notFound, ok } from '../utils/http.js';
import { notifyUsers } from '../utils/notify.js';
import { escapeRegExp, toKeywordArray } from '../utils/text.js';

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

const teacherCreateResourceSchema = z.object({
  subjectId: z.string().min(1),
  resourceType: z.enum(['pdf', 'ebook', 'video', 'link']),
  title: z.string().trim().min(1, 'Resource title is required.').max(200),
  value: z.string().trim().min(1, 'Resource file or URL is required.').max(4_500_000),
  source: z.enum(['file', 'text']).default('text'),
  keywords: z.union([z.array(z.string()), z.string()]).optional()
}).superRefine((payload, ctx) => {
  const isFile = payload.source === 'file';
  const isDocType = payload.resourceType === 'pdf' || payload.resourceType === 'ebook';

  if (isFile && !isDataUrl(payload.value) && !isHttpUrl(payload.value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: 'Uploaded resource is invalid. Please re-upload the file.'
    });
  }

  if (!isFile && !isHttpUrl(payload.value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: 'Please enter a valid URL.'
    });
  }

  if (isDocType && !isFile && !isHttpUrl(payload.value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: 'PDF/EBook must be uploaded as file or shared as a valid URL.'
    });
  }

  if ((payload.resourceType === 'video' || payload.resourceType === 'link') && isFile) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['source'],
      message: 'Video and link resources must use URL input.'
    });
  }
});

function buildSearchQuery(q) {
  const clean = String(q || '').trim();
  if (!clean) return null;
  const regex = new RegExp(escapeRegExp(clean), 'i');
  return {
    $or: [{ title: regex }, { value: regex }, { keywords: regex }]
  };
}

export async function teacherCreateResource(req, res) {
  const parsed = teacherCreateResourceSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message || 'Invalid resource payload.');
  }

  const payload = parsed.data;
  const subject = await Subject.findOne({
    _id: payload.subjectId,
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  }).lean();
  if (!subject) return notFound(res, 'Subject not found.');

  const resource = await Resource.create({
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId,
    subjectId: payload.subjectId,
    resourceType: payload.resourceType,
    title: payload.title,
    value: payload.value,
    source: payload.source,
    keywords: toKeywordArray(payload.keywords || payload.title)
  });

  const profiles = await StudentProfile.find({
    teacherId: req.auth.userId,
    subjects: payload.subjectId
  })
    .select('userId')
    .lean();

  await notifyUsers({
    institutionId: req.auth.institutionId,
    recipientUserIds: profiles.map((profile) => profile.userId),
    type: 'resource',
    message: `New ${payload.resourceType.toUpperCase()} resource added for ${subject.name}: ${payload.title}`
  });

  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: req.auth.userId,
    role: 'teacher',
    eventType: 'resource_uploaded',
    stage: 'engagement',
    metadata: {
      resourceId: resource._id.toString(),
      resourceType: payload.resourceType,
      subjectId: payload.subjectId
    }
  });

  return created(res, { resource }, 'Resource uploaded.');
}

export async function teacherListResources(req, res) {
  const subjectId = String(req.query.subjectId || '').trim();
  const resourceType = String(req.query.resourceType || '').trim();
  const q = String(req.query.q || '').trim();

  const query = {
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  };
  if (subjectId) query.subjectId = subjectId;
  if (resourceType) query.resourceType = resourceType;

  const search = buildSearchQuery(q);
  if (search) Object.assign(query, search);

  const resources = await Resource.find(query).sort({ createdAt: -1 }).lean();
  return ok(res, { resources });
}

export async function teacherDeleteResource(req, res) {
  const resource = await Resource.findOne({
    _id: req.params.resourceId,
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  });
  if (!resource) return notFound(res, 'Resource not found.');

  await resource.deleteOne();
  return ok(res, {}, 'Resource deleted.');
}

export async function studentListResources(req, res) {
  const profile = await StudentProfile.findOne({ userId: req.auth.userId })
    .select('subjects teacherId')
    .lean();
  if (!profile || !profile.subjects?.length) return ok(res, { resources: [] });

  const requestedSubjectId = String(req.query.subjectId || '').trim();
  const allowedSubjectIds = profile.subjects.map((id) => id.toString());

  const subjectIds = requestedSubjectId
    ? allowedSubjectIds.includes(requestedSubjectId)
      ? [requestedSubjectId]
      : []
    : allowedSubjectIds;

  if (!subjectIds.length) return ok(res, { resources: [] });

  const query = {
    institutionId: req.auth.institutionId,
    subjectId: { $in: subjectIds }
  };
  if (profile.teacherId) {
    query.teacherId = profile.teacherId;
  }

  const resourceType = String(req.query.resourceType || '').trim();
  if (resourceType) query.resourceType = resourceType;

  const search = buildSearchQuery(req.query.q);
  if (search) Object.assign(query, search);

  const resources = await Resource.find(query).sort({ createdAt: -1 }).lean();

  const [subjects, teachers] = await Promise.all([
    Subject.find({ _id: { $in: resources.map((item) => item.subjectId) } })
      .select('name')
      .lean(),
    User.find({ _id: { $in: resources.map((item) => item.teacherId) }, role: 'teacher' })
      .select('fullName')
      .lean()
  ]);

  const subjectMap = new Map(subjects.map((item) => [item._id.toString(), item.name]));
  const teacherMap = new Map(teachers.map((item) => [item._id.toString(), item.fullName]));

  const enriched = resources.map((resource) => ({
    ...resource,
    subjectName: subjectMap.get(resource.subjectId.toString()) || '',
    teacherName: teacherMap.get(resource.teacherId.toString()) || ''
  }));

  return ok(res, { resources: enriched });
}
