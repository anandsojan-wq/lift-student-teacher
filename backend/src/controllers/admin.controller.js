import { z } from 'zod';
import { Test } from '../models/Test.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { User } from '../models/User.js';
import { trackAnalyticsEvent } from '../services/analytics.service.js';
import { triggerAutomation } from '../services/automation.service.js';
import { badRequest, created, notFound, ok } from '../utils/http.js';

const createTeacherSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters.'),
  username: z.string().trim().min(3, 'Username must be at least 3 characters.'),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  email: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return '';
      return value.trim();
    },
    z.string().email('Please enter a valid email address.').or(z.literal(''))
  ),
  phone: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return '';
      return value.trim();
    },
    z.string().or(z.literal(''))
  )
});

const updateTeacherSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters.'),
  username: z.string().trim().min(3, 'Username must be at least 3 characters.'),
  email: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return '';
      return value.trim();
    },
    z.string().email('Please enter a valid email address.').or(z.literal(''))
  ),
  phone: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return '';
      return value.trim();
    },
    z.string().or(z.literal(''))
  )
});

const resetTeacherPasswordSchema = z.object({
  password: z.string().min(6, 'Temporary password must be at least 6 characters.')
});

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

const syllabusValueSchema = z
  .string()
  .trim()
  .min(1, 'Syllabus PDF is required.')
  .max(4_500_000, 'Syllabus PDF is too large. Please upload a smaller file.')
  .refine(
    (value) => isHttpUrl(value) || isDataUrl(value),
    'Syllabus must be a PDF upload or a valid URL.'
  );

const createSubjectSchema = z.object({
  name: z.string().trim().min(2, 'Course name must be at least 2 characters.'),
  courseDuration: z.string().trim().min(2, 'Course duration is required.').max(80),
  syllabusPdfUrl: syllabusValueSchema,
  syllabusPdfName: z.string().trim().max(180).optional().or(z.literal(''))
});

const updateSubjectSyllabusSchema = z.object({
  syllabusPdfUrl: syllabusValueSchema,
  syllabusPdfName: z.string().trim().max(180).optional().or(z.literal(''))
});

const updateSubjectSchema = z
  .object({
    name: z.string().trim().min(2, 'Course name must be at least 2 characters.').optional(),
    courseDuration: z.string().trim().min(2, 'Course duration is required.').max(80).optional(),
    syllabusPdfUrl: syllabusValueSchema.optional(),
    syllabusPdfName: z.string().trim().max(180).optional().or(z.literal(''))
  })
  .refine(
    (payload) =>
      Boolean(
        payload.name !== undefined ||
          payload.courseDuration !== undefined ||
          payload.syllabusPdfUrl !== undefined ||
          payload.syllabusPdfName !== undefined
      ),
    'At least one field is required for update.'
  );

export async function createTeacher(req, res) {
  const parsed = createTeacherSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message || 'Invalid teacher payload.');
  }

  const { fullName, username, password, email, phone } = parsed.data;
  const existing = await User.findOne({
    institutionId: req.auth.institutionId,
    username: username.toLowerCase()
  }).lean();
  if (existing) return badRequest(res, 'Username already exists.');

  const passwordHash = await User.hashPassword(password);
  const teacher = await User.create({
    institutionId: req.auth.institutionId,
    role: 'teacher',
    fullName,
    username: username.toLowerCase(),
    passwordHash,
    email: email || '',
    phone: phone || '',
    temporaryPassword: password,
    mustChangePassword: false
  });

  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: teacher._id,
    role: 'teacher',
    eventType: 'teacher_account_created',
    stage: 'onboarding',
    metadata: {
      username: teacher.username
    }
  });
  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: req.auth.userId,
    role: 'admin',
    eventType: 'teacher_created_by_admin',
    stage: 'activation',
    metadata: {
      teacherId: teacher._id.toString(),
      teacherUsername: teacher.username
    }
  });

  await triggerAutomation({
    eventType: 'onboarding.new_teacher',
    institutionId: req.auth.institutionId,
    triggerRole: 'admin',
    payload: {
      teacher: {
        id: teacher._id.toString(),
        fullName: teacher.fullName,
        username: teacher.username,
        email: teacher.email,
        phone: teacher.phone,
        temporaryPassword: password
      }
    }
  });

  return created(res, {
    teacher: {
      id: teacher._id,
      username: teacher.username,
      fullName: teacher.fullName,
      email: teacher.email,
      phone: teacher.phone,
      temporaryPassword: teacher.temporaryPassword || ''
    }
  });
}

export async function listTeachers(req, res) {
  const teachers = await User.find({
    institutionId: req.auth.institutionId,
    role: 'teacher',
    isActive: true
  })
    .select('-passwordHash')
    .lean();
  return ok(res, { teachers });
}

export async function listStudents(req, res) {
  const q = String(req.query.q || '').trim();
  const subjectId = String(req.query.subjectId || '').trim();

  const allInstitutionStudents = await User.find({
    institutionId: req.auth.institutionId,
    role: 'student'
  })
    .select('_id')
    .lean();
  const institutionStudentIds = allInstitutionStudents.map((item) => item._id);

  const profiles = await StudentProfile.find({
    userId: { $in: institutionStudentIds }
  }).lean();
  const subjectFilteredProfiles = subjectId
    ? profiles.filter((profile) =>
        (profile.subjects || []).some((id) => id.toString() === subjectId)
      )
    : profiles;

  const userIds = subjectFilteredProfiles.map((profile) => profile.userId);

  const query = {
    institutionId: req.auth.institutionId,
    role: 'student',
    _id: { $in: userIds.length ? userIds : institutionStudentIds }
  };
  if (q) query.fullName = { $regex: q, $options: 'i' };

  const students = await User.find(query).select('-passwordHash').lean();

  const subjectIds = Array.from(
    new Set(
      subjectFilteredProfiles.flatMap((profile) =>
        (profile.subjects || []).map((id) => id.toString())
      )
    )
  );
  const subjects = await Subject.find({ _id: { $in: subjectIds } })
    .select('name')
    .lean();
  const subjectMap = new Map(subjects.map((subject) => [subject._id.toString(), subject.name]));

  const profileMap = new Map(
    subjectFilteredProfiles.map((profile) => [
      profile.userId.toString(),
      (profile.subjects || []).map((id) => ({
        id: id.toString(),
        name: subjectMap.get(id.toString()) || ''
      }))
    ])
  );

  return ok(res, {
    students: students.map((student) => ({
      ...student,
      subjects: profileMap.get(student._id.toString()) || []
    }))
  });
}

export async function updateTeacher(req, res) {
  const teacherId = String(req.params.teacherId || '').trim();
  if (!teacherId) return badRequest(res, 'Teacher ID is required.');

  const parsed = updateTeacherSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message || 'Invalid teacher payload.');
  }

  const teacher = await User.findOne({
    _id: teacherId,
    institutionId: req.auth.institutionId,
    role: 'teacher',
    isActive: true
  });
  if (!teacher) return notFound(res, 'Teacher not found.');

  const payload = parsed.data;
  const nextUsername = payload.username.toLowerCase();
  if (nextUsername !== teacher.username) {
    const duplicate = await User.findOne({
      institutionId: req.auth.institutionId,
      username: nextUsername,
      _id: { $ne: teacher._id }
    }).lean();
    if (duplicate) return badRequest(res, 'Username already exists.');
    teacher.username = nextUsername;
  }

  teacher.fullName = payload.fullName;
  teacher.email = payload.email || '';
  teacher.phone = payload.phone || '';
  await teacher.save();

  return ok(
    res,
    {
      teacher: {
        id: teacher._id,
        username: teacher.username,
        fullName: teacher.fullName,
        email: teacher.email || '',
        phone: teacher.phone || '',
        temporaryPassword: teacher.temporaryPassword || ''
      }
    },
    'Teacher updated successfully.'
  );
}

export async function dashboardSummary(req, res) {
  const institutionId = req.auth.institutionId;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const lookbackStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [teachers, students, subjects, recentTests, testsPublishedToday] = await Promise.all([
    User.find({ institutionId, role: 'teacher', isActive: true }).select('_id fullName').lean(),
    User.find({ institutionId, role: 'student', isActive: true }).select('_id').lean(),
    Subject.find({ institutionId })
      .select('_id name courseDuration syllabusPdfUrl')
      .sort({ name: 1, createdAt: -1 })
      .lean(),
    Test.find({
      institutionId,
      archivedAt: null,
      createdAt: { $gte: lookbackStart }
    })
      .select('subjectId createdAt')
      .lean(),
    Test.countDocuments({
      institutionId,
      archivedAt: null,
      createdAt: { $gte: startOfToday }
    })
  ]);

  const teacherCount = teachers.length;
  const studentCount = students.length;
  const subjectCount = subjects.length;

  const activeTeacherIds = teachers.map((teacher) => teacher._id);
  const activeStudentIds = students.map((student) => student._id);

  const profiles = activeStudentIds.length
    ? await StudentProfile.find({
        userId: { $in: activeStudentIds },
        teacherId: { $in: activeTeacherIds }
      })
        .select('subjects')
        .lean()
    : [];

  const subjectStudentCounts = new Map();
  profiles.forEach((profile) => {
    (profile.subjects || []).forEach((subjectId) => {
      const key = subjectId?.toString();
      if (!key) return;
      subjectStudentCounts.set(key, (subjectStudentCounts.get(key) || 0) + 1);
    });
  });

  const recentTestCounts = new Map();
  recentTests.forEach((test) => {
    const key = test.subjectId?.toString();
    if (!key) return;
    recentTestCounts.set(key, (recentTestCounts.get(key) || 0) + 1);
  });

  const coursesNeedingAttention = subjects
    .map((subject) => {
      const reasons = [];
      const subjectId = subject._id.toString();
      const enrolledCount = subjectStudentCounts.get(subjectId) || 0;
      const recentTestCount = recentTestCounts.get(subjectId) || 0;

      if (!String(subject.syllabusPdfUrl || '').trim()) reasons.push('Missing syllabus');
      if (enrolledCount === 0) reasons.push('No students enrolled');
      if (recentTestCount === 0) reasons.push('No test in the last 14 days');

      return {
        id: subject._id,
        name: subject.name,
        courseDuration: subject.courseDuration || '',
        enrolledCount,
        recentTestCount,
        reasons
      };
    })
    .filter((subject) => subject.reasons.length)
    .sort((left, right) => right.reasons.length - left.reasons.length || left.name.localeCompare(right.name));

  const actionsToday = [];
  if (teacherCount === 0) {
    actionsToday.push({
      title: 'Create your first teacher',
      description: 'Teachers unlock student onboarding, resources, class plans and assessments.'
    });
  }
  if (studentCount === 0) {
    actionsToday.push({
      title: 'Add students to your courses',
      description: 'No active students are enrolled yet, so today’s learning flow cannot begin.'
    });
  }
  const missingSyllabusCount = coursesNeedingAttention.filter((item) =>
    item.reasons.includes('Missing syllabus')
  ).length;
  if (missingSyllabusCount > 0) {
    actionsToday.push({
      title: `${missingSyllabusCount} course${missingSyllabusCount === 1 ? '' : 's'} need syllabus updates`,
      description: 'Open Courses and upload the latest syllabus so students can view it in their dashboard.'
    });
  }
  const noStudentsCount = coursesNeedingAttention.filter((item) =>
    item.reasons.includes('No students enrolled')
  ).length;
  if (noStudentsCount > 0) {
    actionsToday.push({
      title: `${noStudentsCount} course${noStudentsCount === 1 ? '' : 's'} have no students`,
      description: 'Assign students to these courses so teachers can publish tests and class materials for them.'
    });
  }
  if (testsPublishedToday === 0) {
    actionsToday.push({
      title: 'No tests published today',
      description: 'Ask teachers to publish or schedule today’s assessment so students see fresh work in their queue.'
    });
  }
  if (!actionsToday.length) {
    actionsToday.push({
      title: 'You are on track today',
      description: 'Teachers, students, courses and tests are active. Use Analytics to monitor engagement.'
    });
  }

  return ok(res, {
    summary: {
      teacherCount,
      studentCount,
      subjectCount,
      testsPublishedToday,
      studentsPerTeacher: teacherCount ? Math.round((studentCount / teacherCount) * 10) / 10 : 0,
      coursesNeedingAttention,
      coursesNeedingAttentionCount: coursesNeedingAttention.length,
      actionsToday
    }
  });
}

export async function listSubjects(req, res) {
  const subjects = await Subject.find({
    institutionId: req.auth.institutionId
  })
    .select('name courseDuration syllabusPdfUrl syllabusPdfName teacherId createdAt updatedAt')
    .sort({ name: 1, createdAt: -1 })
    .lean();

  return ok(res, { subjects });
}

export async function createSubject(req, res) {
  const parsed = createSubjectSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message || 'Invalid subject payload.');
  }

  const payload = parsed.data;
  const existing = await Subject.findOne({
    institutionId: req.auth.institutionId,
    name: payload.name
  }).lean();
  if (existing) return badRequest(res, 'Subject already exists for this institution.');

  const subject = await Subject.create({
    institutionId: req.auth.institutionId,
    teacherId: null,
    name: payload.name,
    courseDuration: payload.courseDuration,
    syllabusPdfUrl: payload.syllabusPdfUrl || '',
    syllabusPdfName: payload.syllabusPdfName || ''
  });

  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: req.auth.userId,
    role: 'admin',
    eventType: 'subject_created_by_admin',
    stage: 'activation',
    metadata: {
      subjectId: subject._id.toString(),
      subjectName: subject.name
    }
  });

  return created(res, { subject }, 'Course created.');
}

export async function updateSubject(req, res) {
  const parsed = updateSubjectSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message || 'Invalid course payload.');
  }

  const subjectId = String(req.params.subjectId || '').trim();
  if (!subjectId) return badRequest(res, 'Subject ID is required.');

  const subject = await Subject.findOne({
    _id: subjectId,
    institutionId: req.auth.institutionId
  });
  if (!subject) return notFound(res, 'Subject not found.');

  const payload = parsed.data;
  if (payload.name && payload.name !== subject.name) {
    const existing = await Subject.findOne({
      institutionId: req.auth.institutionId,
      name: payload.name,
      _id: { $ne: subject._id }
    }).lean();
    if (existing) return badRequest(res, 'Subject already exists for this institution.');
    subject.name = payload.name;
  }
  if (payload.courseDuration !== undefined) {
    subject.courseDuration = payload.courseDuration;
  }
  if (payload.syllabusPdfUrl !== undefined) {
    subject.syllabusPdfUrl = payload.syllabusPdfUrl;
  }
  if (payload.syllabusPdfName !== undefined) {
    subject.syllabusPdfName = payload.syllabusPdfName || subject.syllabusPdfName || '';
  }

  await subject.save();

  return ok(res, { subject }, 'Course updated.');
}

export async function updateSubjectSyllabus(req, res) {
  const parsed = updateSubjectSyllabusSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message || 'Invalid syllabus payload.');
  }

  const subjectId = String(req.params.subjectId || '').trim();
  if (!subjectId) return badRequest(res, 'Subject ID is required.');

  const subject = await Subject.findOne({
    _id: subjectId,
    institutionId: req.auth.institutionId
  });
  if (!subject) return notFound(res, 'Subject not found.');

  subject.syllabusPdfUrl = parsed.data.syllabusPdfUrl;
  subject.syllabusPdfName = parsed.data.syllabusPdfName || subject.syllabusPdfName || '';
  await subject.save();

  return ok(res, { subject }, 'Syllabus updated.');
}

export async function deleteSubject(req, res) {
  const subjectId = String(req.params.subjectId || '').trim();
  if (!subjectId) return badRequest(res, 'Subject ID is required.');

  const subject = await Subject.findOne({
    _id: subjectId,
    institutionId: req.auth.institutionId
  });
  if (!subject) return notFound(res, 'Subject not found.');

  await StudentProfile.updateMany(
    { userId: { $ne: null } },
    { $pull: { subjects: subject._id } }
  );
  await subject.deleteOne();

  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: req.auth.userId,
    role: 'admin',
    eventType: 'subject_deleted_by_admin',
    stage: 'ops',
    metadata: {
      subjectId: subjectId,
      subjectName: subject.name
    }
  });

  return ok(res, {}, 'Subject deleted.');
}

export async function deleteTeacher(req, res) {
  const teacherId = String(req.params.teacherId || '').trim();
  if (!teacherId) return badRequest(res, 'Teacher ID is required.');

  const teacher = await User.findOne({
    _id: teacherId,
    institutionId: req.auth.institutionId,
    role: 'teacher',
    isActive: true
  });
  if (!teacher) return notFound(res, 'Teacher not found.');

  teacher.isActive = false;
  await teacher.save();

  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: req.auth.userId,
    role: 'admin',
    eventType: 'teacher_deactivated',
    stage: 'ops',
    metadata: {
      teacherId: teacher._id.toString(),
      teacherUsername: teacher.username
    }
  });

  return ok(res, {}, 'Teacher removed successfully.');
}

export async function resetTeacherPassword(req, res) {
  const teacherId = String(req.params.teacherId || '').trim();
  if (!teacherId) return badRequest(res, 'Teacher ID is required.');

  const parsed = resetTeacherPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(
      res,
      parsed.error.issues[0]?.message || 'Invalid password reset payload.'
    );
  }

  const teacher = await User.findOne({
    _id: teacherId,
    institutionId: req.auth.institutionId,
    role: 'teacher',
    isActive: true
  });
  if (!teacher) return notFound(res, 'Teacher not found.');

  const password = parsed.data.password;
  teacher.passwordHash = await User.hashPassword(password);
  teacher.temporaryPassword = password;
  teacher.mustChangePassword = false;
  await teacher.save();

  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: req.auth.userId,
    role: 'admin',
    eventType: 'teacher_temp_password_reset',
    stage: 'ops',
    metadata: {
      teacherId: teacher._id.toString(),
      teacherUsername: teacher.username
    }
  });

  return ok(res, {
    teacher: {
      id: teacher._id,
      username: teacher.username,
      temporaryPassword: teacher.temporaryPassword
    }
  }, 'Temporary password reset successfully.');
}
