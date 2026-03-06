import { z } from 'zod';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { User } from '../models/User.js';
import { trackAnalyticsEvent } from '../services/analytics.service.js';
import { triggerAutomation } from '../services/automation.service.js';
import { badRequest, notFound, ok } from '../utils/http.js';

const createStudentSchema = z.object({
  fullName: z.string().min(2),
  username: z.string().min(3),
  password: z.string().min(6),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  parentEmail: z.string().email().optional().or(z.literal('')),
  parentPhone: z.string().optional().or(z.literal('')),
  subjectIds: z.array(z.string().min(1)).min(1)
});

export async function listMySubjects(req, res) {
  const subjects = await Subject.find({
    institutionId: req.auth.institutionId
  })
    .sort({ name: 1, createdAt: -1 })
    .lean();

  return ok(res, { subjects });
}

export async function createStudent(req, res) {
  const parsed = createStudentSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Invalid student payload.');

  const { fullName, username, password, email, phone, parentEmail, parentPhone, subjectIds } = parsed.data;

  const existing = await User.findOne({
    institutionId: req.auth.institutionId,
    username: username.toLowerCase()
  }).lean();
  if (existing) return badRequest(res, 'Username already exists.');

  const allowedSubjects = await Subject.find({
    _id: { $in: subjectIds },
    institutionId: req.auth.institutionId
  })
    .select('_id')
    .lean();

  if (allowedSubjects.length !== subjectIds.length) {
    return badRequest(res, 'One or more subjects are invalid for this institution.');
  }

  const passwordHash = await User.hashPassword(password);
  const student = await User.create({
    institutionId: req.auth.institutionId,
    role: 'student',
    fullName,
    username: username.toLowerCase(),
    passwordHash,
    email: email || '',
    phone: phone || '',
    temporaryPassword: password,
    mustChangePassword: false
  });

  const profile = await StudentProfile.create({
    userId: student._id,
    teacherId: req.auth.userId,
    subjects: allowedSubjects.map((s) => s._id),
    parentEmail: parentEmail || '',
    parentPhone: parentPhone || ''
  });

  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: student._id,
    role: 'student',
    eventType: 'student_account_created',
    stage: 'onboarding',
    metadata: {
      username: student.username
    }
  });
  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: req.auth.userId,
    role: 'teacher',
    eventType: 'student_created_by_teacher',
    stage: 'activation',
    metadata: {
      studentId: student._id.toString(),
      subjectIds: allowedSubjects.map((s) => s._id.toString())
    }
  });

  await triggerAutomation({
    eventType: 'onboarding.new_student',
    institutionId: req.auth.institutionId,
    triggerRole: 'teacher',
    payload: {
      student: {
        id: student._id.toString(),
        fullName: student.fullName,
        username: student.username,
        email: student.email,
        phone: student.phone,
        temporaryPassword: password
      },
      teacherId: req.auth.userId,
      subjectIds: allowedSubjects.map((subject) => subject._id.toString())
    }
  });

  return ok(res, {
    student: {
      id: student._id,
      fullName: student.fullName,
      username: student.username,
      email: student.email,
      phone: student.phone,
      temporaryPassword: student.temporaryPassword || ''
    },
    profile
  }, 'Student created.');
}

export async function listMyStudents(req, res) {
  const subjectId = req.query.subjectId || '';
  const q = (req.query.q || '').trim();

  const profileQuery = {
    teacherId: req.auth.userId
  };
  if (subjectId) {
    profileQuery.subjects = subjectId;
  }

  const profiles = await StudentProfile.find(profileQuery).lean();
  if (!profiles.length) return ok(res, { students: [] });
  const userIds = profiles.map((p) => p.userId);

  const userQuery = {
    _id: { $in: userIds },
    institutionId: req.auth.institutionId,
    role: 'student'
  };
  if (q) userQuery.fullName = { $regex: q, $options: 'i' };

  const students = await User.find(userQuery)
    .select('-passwordHash')
    .sort({ fullName: 1 })
    .lean();

  const allSubjectIds = Array.from(
    new Set(
      profiles.flatMap((profile) => (profile.subjects || []).map((id) => id.toString()))
    )
  );
  const subjects = await Subject.find({ _id: { $in: allSubjectIds } })
    .select('name')
    .lean();
  const subjectMap = new Map(subjects.map((subject) => [subject._id.toString(), subject.name]));
  const profileMap = new Map(
    profiles.map((profile) => [
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

export async function deleteStudent(req, res) {
  const studentId = req.params.studentId;
  const student = await User.findOne({
    _id: studentId,
    institutionId: req.auth.institutionId,
    role: 'student'
  });
  if (!student) return notFound(res, 'Student not found.');

  const profile = await StudentProfile.findOne({
    userId: student._id,
    teacherId: req.auth.userId
  });
  if (!profile) return notFound(res, 'Student not assigned to this teacher.');

  await StudentProfile.deleteOne({ _id: profile._id });
  await User.deleteOne({ _id: student._id });

  return ok(res, {}, 'Student deleted.');
}
