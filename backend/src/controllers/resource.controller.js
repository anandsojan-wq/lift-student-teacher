import { z } from 'zod';
import { ClassPlan } from '../models/ClassPlan.js';
import { Resource } from '../models/Resource.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { User } from '../models/User.js';
import { trackAnalyticsEvent } from '../services/analytics.service.js';
import { resolveInlineAsset, sendInlineAsset } from '../utils/protected-file.js';
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
  resourceType: z.enum(['pdf', 'ebook', 'video', 'link', 'notes']),
  title: z.string().trim().min(1, 'Resource title is required.').max(200),
  value: z.string().trim().min(1, 'Resource file or URL is required.').max(4_500_000),
  source: z.enum(['file', 'text']).default('text'),
  keywords: z.union([z.array(z.string()), z.string()]).optional()
}).superRefine((payload, ctx) => {
  const isFile = payload.source === 'file';
  const isDocType = payload.resourceType === 'pdf' || payload.resourceType === 'ebook';
  const isNotesType = payload.resourceType === 'notes';

  if (isFile && !isDataUrl(payload.value) && !isHttpUrl(payload.value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: 'Uploaded resource is invalid. Please re-upload the file.'
    });
  }

  if (!isFile && !isHttpUrl(payload.value) && !isNotesType) {
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

  if (isNotesType && isFile) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['source'],
      message: 'Notes must be created as text.'
    });
  }
});

const resourceTrashSchema = z.object({
  trashed: z.boolean().default(true)
});

function parsePagination(query, defaultLimit = 12, maxLimit = 60) {
  const rawLimit = Number.parseInt(String(query?.limit || defaultLimit), 10);
  const rawOffset = Number.parseInt(String(query?.offset || 0), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), maxLimit) : defaultLimit;
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;
  return { limit, offset };
}

function buildSearchQuery(q) {
  const clean = String(q || '').trim();
  if (!clean) return null;
  const regex = new RegExp(escapeRegExp(clean), 'i');
  return {
    $or: [{ title: regex }, { value: regex }, { keywords: regex }]
  };
}

function isStudentProtectedDocument(resource) {
  return ['pdf', 'ebook'].includes(String(resource?.resourceType || '').toLowerCase());
}

function studentResourceViewUrl(resourceId) {
  return `/api/student/resources/${resourceId}/view`;
}

function teacherResourceViewUrl(resourceId) {
  return `/api/teacher/resources/${resourceId}/view`;
}

function buildProtectedResourceFileName(resource) {
  const title = String(resource?.title || 'resource').trim() || 'resource';
  const ext = String(resource?.resourceType || '').toLowerCase() === 'ebook' ? '.epub' : '.pdf';
  return title.toLowerCase().endsWith(ext) ? title : `${title}${ext}`;
}

function normalizeResourceStatus(status) {
  const normalized = String(status || 'active').trim().toLowerCase();
  if (normalized === 'trashed' || normalized === 'all') return normalized;
  return 'active';
}

function normalizeResourceContext(context) {
  const normalized = String(context || '').trim().toLowerCase();
  if (normalized === 'library' || normalized === 'class_plan') return normalized;
  if (normalized === 'all') return 'all';
  return '';
}

function applyResourceContext(query, context, classPlanResourceIds = []) {
  if (!context || context === 'all') return;

  const hasClassPlanIds = Array.isArray(classPlanResourceIds) && classPlanResourceIds.length > 0;

  if (context === 'class_plan') {
    if (hasClassPlanIds) {
      query.$or = [
        { resourceContext: 'class_plan' },
        { _id: { $in: classPlanResourceIds } }
      ];
    } else {
      query.resourceContext = 'class_plan';
    }
    return;
  }

  const libraryContextQuery = {
    $or: [{ resourceContext: 'library' }, { resourceContext: null }, { resourceContext: { $exists: false } }]
  };

  if (hasClassPlanIds) {
    query.$and = [...(query.$and || []), libraryContextQuery, { _id: { $nin: classPlanResourceIds } }];
    return;
  }

  Object.assign(query, libraryContextQuery);
}

function applyResourceStatus(query, status) {
  if (status === 'trashed') {
    query.deletedAt = { $ne: null };
    return;
  }
  if (status === 'all') return;
  query.deletedAt = null;
}

function buildResourceResponse(resource, { subjectMap, teacherMap, classPlanMap, viewer = 'student' } = {}) {
  const subjectName = subjectMap?.get(resource.subjectId?.toString()) || '';
  const teacherName = teacherMap?.get(resource.teacherId?.toString()) || '';
  const classPlan = classPlanMap?.get(resource._id?.toString()) || null;
  const effectiveResourceContext = resource.resourceContext || (classPlan ? 'class_plan' : 'library');
  const payload = {
    ...resource,
    subjectName,
    teacherName,
    resourceContext: effectiveResourceContext,
    deletedAt: resource.deletedAt || null,
    classPlan: classPlan
      ? {
          id: classPlan._id,
          title: classPlan.title,
          scheduledDate: classPlan.scheduledDate,
          startTime: classPlan.startTime || '',
          endTime: classPlan.endTime || ''
        }
      : null
  };

  if (isStudentProtectedDocument(resource)) {
    payload.value = '';
    payload.viewUrl =
      viewer === 'teacher'
        ? teacherResourceViewUrl(resource._id)
        : studentResourceViewUrl(resource._id);
  }

  return payload;
}

export async function teacherCreateResource(req, res) {
  const parsed = teacherCreateResourceSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message || 'Invalid resource payload.');
  }

  const payload = parsed.data;
  const subject = await Subject.findOne({
    _id: payload.subjectId,
    institutionId: req.auth.institutionId
  }).lean();
  if (!subject) return notFound(res, 'Subject not found.');

  const resource = await Resource.create({
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId,
    subjectId: payload.subjectId,
    resourceType: payload.resourceType,
    resourceContext: 'library',
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
    message: `New ${payload.resourceType === 'notes' ? 'notes' : payload.resourceType.toUpperCase()} resource added for ${subject.name}: ${payload.title}`
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
  const status = normalizeResourceStatus(req.query.status);
  const context = normalizeResourceContext(req.query.context);
  const { limit, offset } = parsePagination(req.query, 12, 80);

  const query = {
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  };
  if (subjectId) query.subjectId = subjectId;
  if (resourceType) query.resourceType = resourceType;
  applyResourceStatus(query, status);

  const search = buildSearchQuery(q);
  if (search) Object.assign(query, search);

  const classPlans = await ClassPlan.find({
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId,
    resourceId: { $ne: null }
  })
    .select('resourceId title scheduledDate startTime endTime')
    .lean();

  const classPlanResourceIds = classPlans
    .map((plan) => plan.resourceId)
    .filter(Boolean);
  applyResourceContext(query, context, classPlanResourceIds);

  const [resources, total, subjects] = await Promise.all([
    Resource.find(query).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
    Resource.countDocuments(query),
    Subject.find({ institutionId: req.auth.institutionId }).select('name').lean()
  ]);

  const subjectMap = new Map(subjects.map((item) => [item._id.toString(), item.name]));
  const classPlanMap = new Map(
    classPlans
      .filter((plan) => plan.resourceId)
      .map((plan) => [plan.resourceId.toString(), plan])
  );

  return ok(res, {
    resources: resources.map((resource) =>
      buildResourceResponse(resource, { subjectMap, classPlanMap, viewer: 'teacher' })
    ),
    summary: {
      total,
      shownCount: resources.length,
      limit,
      offset,
      hasMore: offset + resources.length < total
    }
  });
}

export async function teacherTrashResource(req, res) {
  const parsed = resourceTrashSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message || 'Invalid trash payload.');
  }

  const resource = await Resource.findOne({
    _id: req.params.resourceId,
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  });
  if (!resource) return notFound(res, 'Resource not found.');

  resource.deletedAt = parsed.data.trashed ? new Date() : null;
  await resource.save();
  return ok(
    res,
    {
      resource: {
        id: resource._id,
        deletedAt: resource.deletedAt
      }
    },
    parsed.data.trashed ? 'Resource moved to trash.' : 'Resource restored.'
  );
}

export async function teacherDeleteResource(req, res) {
  const resource = await Resource.findOne({
    _id: req.params.resourceId,
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  });
  if (!resource) return notFound(res, 'Resource not found.');
  if (!resource.deletedAt) {
    resource.deletedAt = new Date();
    await resource.save();
    return ok(res, {}, 'Resource moved to trash.');
  }

  await ClassPlan.updateMany({ resourceId: resource._id }, { $set: { resourceId: null } });
  await resource.deleteOne();
  return ok(res, {}, 'Resource deleted permanently.');
}

export async function teacherViewResource(req, res) {
  const resource = await Resource.findOne({
    _id: req.params.resourceId,
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId,
    deletedAt: null
  })
    .select('title resourceType value source')
    .lean();

  if (!resource || !isStudentProtectedDocument(resource)) {
    return notFound(res, 'Resource not found.');
  }

  try {
    const asset = await resolveInlineAsset({
      sourceUrl: resource.value,
      fallbackFileName: buildProtectedResourceFileName(resource),
      fallbackContentType:
        String(resource.resourceType || '').toLowerCase() === 'ebook'
          ? 'application/epub+zip'
          : 'application/pdf'
    });
    return sendInlineAsset(res, asset);
  } catch (error) {
    return badRequest(res, 'Unable to open this resource right now.');
  }
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
    subjectId: { $in: subjectIds },
    deletedAt: null
  };
  if (profile.teacherId) {
    query.teacherId = profile.teacherId;
  }

  const resourceType = String(req.query.resourceType || '').trim();
  if (resourceType) query.resourceType = resourceType;
  const context = normalizeResourceContext(req.query.context);
  const { limit, offset } = parsePagination(req.query, 18, 80);

  const search = buildSearchQuery(req.query.q);
  if (search) Object.assign(query, search);

  const classPlans = await ClassPlan.find({
    institutionId: req.auth.institutionId,
    resourceId: { $ne: null }
  })
    .select('resourceId title scheduledDate startTime endTime')
    .lean();

  const classPlanResourceIds = classPlans
    .map((plan) => plan.resourceId)
    .filter(Boolean);
  applyResourceContext(query, context, classPlanResourceIds);

  const [resources, total] = await Promise.all([
    Resource.find(query).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
    Resource.countDocuments(query)
  ]);

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

  const classPlanMap = new Map(
    classPlans
      .filter((plan) => plan.resourceId)
      .map((plan) => [plan.resourceId.toString(), plan])
  );

  const enriched = resources.map((resource) =>
    buildResourceResponse(resource, { subjectMap, teacherMap, classPlanMap, viewer: 'student' })
  );

  return ok(res, {
    resources: enriched,
    summary: {
      total,
      shownCount: enriched.length,
      limit,
      offset,
      hasMore: offset + enriched.length < total
    }
  });
}

export async function studentViewResource(req, res) {
  const profile = await StudentProfile.findOne({ userId: req.auth.userId })
    .select('subjects teacherId')
    .lean();
  if (!profile?.subjects?.length) return notFound(res, 'Resource not found.');

  const query = {
    _id: req.params.resourceId,
    institutionId: req.auth.institutionId,
    subjectId: { $in: profile.subjects },
    deletedAt: null
  };
  if (profile.teacherId) {
    query.teacherId = profile.teacherId;
  }

  const resource = await Resource.findOne(query).lean();
  if (!resource || !isStudentProtectedDocument(resource)) {
    return notFound(res, 'Resource not found.');
  }

  try {
    const asset = await resolveInlineAsset({
      sourceUrl: resource.value,
      fallbackFileName: buildProtectedResourceFileName(resource),
      fallbackContentType:
        resource.resourceType === 'ebook' ? 'application/epub+zip' : 'application/pdf'
    });
    return sendInlineAsset(res, asset);
  } catch (error) {
    return badRequest(res, 'Unable to open this resource right now.');
  }
}
