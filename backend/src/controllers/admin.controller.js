import { z } from 'zod';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { User } from '../models/User.js';
import { trackAnalyticsEvent } from '../services/analytics.service.js';
import { triggerAutomation } from '../services/automation.service.js';
import { badRequest, created, ok } from '../utils/http.js';

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
      phone: teacher.phone
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

export async function dashboardSummary(req, res) {
  const [teacherCount, studentCount, subjectCount] = await Promise.all([
    User.countDocuments({ institutionId: req.auth.institutionId, role: 'teacher', isActive: true }),
    User.countDocuments({ institutionId: req.auth.institutionId, role: 'student', isActive: true }),
    Subject.countDocuments({ institutionId: req.auth.institutionId })
  ]);

  return ok(res, {
    summary: {
      teacherCount,
      studentCount,
      subjectCount
    }
  });
}

export async function listSubjects(req, res) {
  const subjects = await Subject.find({
    institutionId: req.auth.institutionId
  })
    .select('name teacherId createdAt')
    .sort({ createdAt: -1 })
    .lean();

  return ok(res, { subjects });
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
