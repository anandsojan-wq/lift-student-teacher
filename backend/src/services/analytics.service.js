import { Attempt } from '../models/Attempt.js';
import { AnalyticsEvent } from '../models/AnalyticsEvent.js';
import { Institution } from '../models/Institution.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { Test } from '../models/Test.js';
import { User } from '../models/User.js';

const ROLE_LIST = ['admin', 'teacher', 'student'];

function toKey(value) {
  return String(value || '');
}

function toObjectIdList(values = []) {
  return values.map((value) => toKey(value)).filter(Boolean);
}

function setFrom(values = []) {
  return new Set(toObjectIdList(values));
}

function intersection(...sets) {
  if (!sets.length) return new Set();
  const [first, ...rest] = sets;
  const out = new Set();
  first.forEach((value) => {
    if (rest.every((set) => set.has(value))) out.add(value);
  });
  return out;
}

function union(...sets) {
  const out = new Set();
  sets.forEach((set) => {
    set.forEach((value) => out.add(value));
  });
  return out;
}

function normalizeWindowDays(raw, fallback = 30) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(365, Math.floor(parsed));
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function step(name, count, previous) {
  return {
    name,
    count,
    dropOffFromPrevious: Math.max(0, previous - count)
  };
}

export async function trackAnalyticsEvent({
  institutionId,
  userId = null,
  role = 'system',
  eventType,
  stage = '',
  metadata = {}
}) {
  if (!institutionId || !eventType) return;

  try {
    await AnalyticsEvent.create({
      institutionId,
      userId,
      role,
      eventType,
      stage,
      metadata
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('analytics event failed:', error.message);
    }
  }
}

async function roleActivitySet({ role, institutionId, sinceDate }) {
  const query = {
    role,
    userId: { $ne: null },
    createdAt: { $gte: sinceDate }
  };
  if (institutionId) query.institutionId = institutionId;

  const userIds = await AnalyticsEvent.distinct('userId', query);
  return setFrom(userIds);
}

async function roleLoginSet({ role, institutionId }) {
  const query = {
    role,
    eventType: 'login_success',
    userId: { $ne: null }
  };
  if (institutionId) query.institutionId = institutionId;

  const userIds = await AnalyticsEvent.distinct('userId', query);
  return setFrom(userIds);
}

async function computeTeacherActivationSet({ institutionId, teacherBaseSet }) {
  const subjectTeacherIds = await Subject.distinct('teacherId', institutionId ? { institutionId } : {});
  const studentCreatorIds = await StudentProfile.distinct(
    'teacherId',
    institutionId ? { institutionId } : {}
  );
  const testTeacherIds = await Test.distinct('teacherId', institutionId ? { institutionId } : {});

  const subjectSet = intersection(teacherBaseSet, setFrom(subjectTeacherIds));
  const actionSet = intersection(teacherBaseSet, union(setFrom(studentCreatorIds), setFrom(testTeacherIds)));
  return intersection(subjectSet, actionSet);
}

async function computeStudentActivationSet({ institutionId, studentBaseSet }) {
  const attemptedStudentIds = await Attempt.distinct(
    'studentId',
    institutionId ? { institutionId } : {}
  );
  return intersection(studentBaseSet, setFrom(attemptedStudentIds));
}

async function computeAdminActivationSet({ institutionId, adminBaseSet }) {
  const teacherCreatedAdminIds = await AnalyticsEvent.distinct('userId', {
    role: 'admin',
    eventType: 'teacher_created_by_admin',
    userId: { $ne: null },
    ...(institutionId ? { institutionId } : {})
  });
  const loginSet = await roleLoginSet({ role: 'admin', institutionId });

  const explicitActivation = intersection(adminBaseSet, setFrom(teacherCreatedAdminIds));
  if (explicitActivation.size) return explicitActivation;

  // Backward-compatible fallback for older data that predates analytics events.
  const hasTeacher =
    (await User.countDocuments({
      ...(institutionId ? { institutionId } : {}),
      role: 'teacher',
      isActive: true
    })) > 0;

  if (hasTeacher && adminBaseSet.size) {
    return intersection(adminBaseSet, loginSet.size ? loginSet : adminBaseSet);
  }

  return new Set();
}

async function computeRoleFunnel({ role, institutionId }) {
  const userDocs = await User.find({
    ...(institutionId ? { institutionId } : {}),
    role,
    isActive: true
  })
    .select('_id')
    .lean();

  const baseSet = setFrom(userDocs.map((doc) => doc._id));
  const total = baseSet.size;

  const loginSet = intersection(baseSet, await roleLoginSet({ role, institutionId }));

  let activatedSet = new Set();
  let steps = [];

  if (role === 'admin') {
    activatedSet = await computeAdminActivationSet({ institutionId, adminBaseSet: baseSet });
    steps = [
      step('Accounts Created', total, total),
      step('Logged In', loginSet.size, total),
      step('Created First Teacher', activatedSet.size, loginSet.size)
    ];
  }

  if (role === 'teacher') {
    const activatedTeachers = await computeTeacherActivationSet({
      institutionId,
      teacherBaseSet: baseSet
    });

    const subjectTeacherIds = await Subject.distinct('teacherId', institutionId ? { institutionId } : {});
    const studentCreatorIds = await StudentProfile.distinct(
      'teacherId',
      institutionId ? { institutionId } : {}
    );
    const testTeacherIds = await Test.distinct('teacherId', institutionId ? { institutionId } : {});

    const createdSubjectSet = intersection(baseSet, setFrom(subjectTeacherIds));
    const createdStudentOrTestSet = intersection(
      baseSet,
      union(setFrom(studentCreatorIds), setFrom(testTeacherIds))
    );

    activatedSet = activatedTeachers;
    steps = [
      step('Accounts Created', total, total),
      step('Logged In', loginSet.size, total),
      step('Created Subject', createdSubjectSet.size, loginSet.size),
      step('Created Student/Test', createdStudentOrTestSet.size, createdSubjectSet.size),
      step('Activated', activatedSet.size, createdStudentOrTestSet.size)
    ];
  }

  if (role === 'student') {
    const attemptedSet = await computeStudentActivationSet({
      institutionId,
      studentBaseSet: baseSet
    });

    activatedSet = attemptedSet;
    steps = [
      step('Accounts Created', total, total),
      step('Logged In', loginSet.size, total),
      step('Completed First Test', attemptedSet.size, loginSet.size)
    ];
  }

  const active1d = intersection(
    baseSet,
    await roleActivitySet({ role, institutionId, sinceDate: new Date(Date.now() - 24 * 60 * 60 * 1000) })
  ).size;
  const active7d = intersection(
    baseSet,
    await roleActivitySet({ role, institutionId, sinceDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) })
  ).size;
  const active30d = intersection(
    baseSet,
    await roleActivitySet({ role, institutionId, sinceDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
  ).size;

  return {
    role,
    onboarded: total,
    activated: activatedSet.size,
    activationRate: percent(activatedSet.size, total),
    dropOffCount: Math.max(0, total - activatedSet.size),
    dropOffRate: percent(Math.max(0, total - activatedSet.size), total),
    retention: {
      active1d,
      active7d,
      active30d,
      weeklyRetentionRate: percent(active7d, active30d),
      dailyRetentionRate: percent(active1d, active7d)
    },
    steps
  };
}

async function computeInstitutionStageCounts({ institutionId }) {
  const [teacherCount, subjectCount, studentCount, testCount, attemptCount] = await Promise.all([
    User.countDocuments({ institutionId, role: 'teacher', isActive: true }),
    Subject.countDocuments({ institutionId }),
    User.countDocuments({ institutionId, role: 'student', isActive: true }),
    Test.countDocuments({ institutionId }),
    Attempt.countDocuments({ institutionId })
  ]);

  return {
    teacherCount,
    subjectCount,
    studentCount,
    testCount,
    attemptCount
  };
}

export async function getRoleFunnels({ institutionId = null } = {}) {
  const funnels = await Promise.all(
    ROLE_LIST.map((role) => computeRoleFunnel({ role, institutionId }))
  );

  return {
    admin: funnels.find((item) => item.role === 'admin'),
    teacher: funnels.find((item) => item.role === 'teacher'),
    student: funnels.find((item) => item.role === 'student')
  };
}

export async function getInstitutionAnalytics({ institutionId, windowDays = 30 }) {
  const days = normalizeWindowDays(windowDays, 30);
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [institution, roleFunnels, stageCounts, eventsByType] = await Promise.all([
    Institution.findById(institutionId)
      .select('name institutionId planType paymentStatus isActive trialTeacherLimit trialSubjectLimitPerTeacher studentLimit')
      .lean(),
    getRoleFunnels({ institutionId }),
    computeInstitutionStageCounts({ institutionId }),
    AnalyticsEvent.aggregate([
      { $match: { institutionId, createdAt: { $gte: sinceDate } } },
      { $group: { _id: '$eventType', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ])
  ]);

  return {
    institution,
    windowDays: days,
    roleFunnels,
    stageCounts,
    eventsByType: eventsByType.map((item) => ({ eventType: item._id, count: item.count }))
  };
}

export async function getGlobalAnalytics({ windowDays = 30, limit = 100 } = {}) {
  const days = normalizeWindowDays(windowDays, 30);
  const rowLimit = Math.min(200, Math.max(1, Number(limit) || 100));
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [roleFunnels, institutions, eventsByType, eventVolumeByInstitution] = await Promise.all([
    getRoleFunnels(),
    Institution.find({})
      .sort({ createdAt: -1 })
      .limit(rowLimit)
      .select('name institutionId planType paymentStatus isActive trialTeacherLimit trialSubjectLimitPerTeacher studentLimit')
      .lean(),
    AnalyticsEvent.aggregate([
      { $match: { createdAt: { $gte: sinceDate } } },
      { $group: { _id: '$eventType', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 25 }
    ]),
    AnalyticsEvent.aggregate([
      { $match: { createdAt: { $gte: sinceDate } } },
      { $group: { _id: '$institutionId', eventCount: { $sum: 1 } } }
    ])
  ]);

  const [teacherCounts, studentCounts, subjectCounts, testCounts, attemptCounts] = await Promise.all([
    User.aggregate([
      { $match: { role: 'teacher', isActive: true } },
      { $group: { _id: '$institutionId', count: { $sum: 1 } } }
    ]),
    User.aggregate([
      { $match: { role: 'student', isActive: true } },
      { $group: { _id: '$institutionId', count: { $sum: 1 } } }
    ]),
    Subject.aggregate([{ $group: { _id: '$institutionId', count: { $sum: 1 } } }]),
    Test.aggregate([{ $group: { _id: '$institutionId', count: { $sum: 1 } } }]),
    Attempt.aggregate([{ $group: { _id: '$institutionId', count: { $sum: 1 } } }])
  ]);

  const toMap = (items) =>
    new Map(items.map((item) => [toKey(item._id), Number(item.count || item.eventCount || 0)]));

  const teacherMap = toMap(teacherCounts);
  const studentMap = toMap(studentCounts);
  const subjectMap = toMap(subjectCounts);
  const testMap = toMap(testCounts);
  const attemptMap = toMap(attemptCounts);
  const eventMap = new Map(eventVolumeByInstitution.map((item) => [toKey(item._id), item.eventCount]));

  const institutionRows = institutions.map((institution) => {
    const key = toKey(institution._id);
    const teacherCount = teacherMap.get(key) || 0;
    const studentCount = studentMap.get(key) || 0;

    return {
      id: institution._id,
      name: institution.name,
      institutionId: institution.institutionId,
      planType: institution.planType,
      paymentStatus: institution.paymentStatus,
      isActive: institution.isActive,
      teacherLimit: institution.trialTeacherLimit,
      subjectLimitPerTeacher: institution.trialSubjectLimitPerTeacher,
      studentLimit: institution.studentLimit,
      teacherCount,
      studentCount,
      subjectCount: subjectMap.get(key) || 0,
      testCount: testMap.get(key) || 0,
      attemptCount: attemptMap.get(key) || 0,
      activityEvents: eventMap.get(key) || 0,
      teacherUtilizationRate: percent(teacherCount, institution.trialTeacherLimit),
      studentUtilizationRate: percent(studentCount, institution.studentLimit)
    };
  });

  const institutionFunnel = {
    totalInstitutions: await Institution.countDocuments({}),
    institutionsWithTeachers: await User.aggregate([
      { $match: { role: 'teacher', isActive: true } },
      { $group: { _id: '$institutionId' } },
      { $count: 'count' }
    ]).then((items) => items[0]?.count || 0),
    institutionsWithSubjects: await Subject.aggregate([
      { $group: { _id: '$institutionId' } },
      { $count: 'count' }
    ]).then((items) => items[0]?.count || 0),
    institutionsWithStudents: await User.aggregate([
      { $match: { role: 'student', isActive: true } },
      { $group: { _id: '$institutionId' } },
      { $count: 'count' }
    ]).then((items) => items[0]?.count || 0),
    institutionsWithTests: await Test.aggregate([
      { $group: { _id: '$institutionId' } },
      { $count: 'count' }
    ]).then((items) => items[0]?.count || 0)
  };

  return {
    windowDays: days,
    roleFunnels,
    institutionFunnel,
    eventsByType: eventsByType.map((item) => ({ eventType: item._id, count: item.count })),
    institutions: institutionRows
  };
}
