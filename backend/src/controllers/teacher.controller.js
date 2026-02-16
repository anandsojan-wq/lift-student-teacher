import { z } from 'zod';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { User } from '../models/User.js';
import { badRequest, notFound, ok } from '../utils/http.js';

const createSubjectSchema = z.object({
  name: z.string().min(2),
  syllabusPdfUrl: z.string().url().optional().or(z.literal('')),
  syllabusPdfName: z.string().optional().or(z.literal(''))
});

const createStudentSchema = z.object({
  fullName: z.string().min(2),
  username: z.string().min(3),
  password: z.string().min(6),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  subjectIds: z.array(z.string().min(1)).min(1)
});

export async function createSubject(req, res) {
  const parsed = createSubjectSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Invalid subject payload.');

  const { name, syllabusPdfUrl, syllabusPdfName } = parsed.data;
  const existing = await Subject.findOne({
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId,
    name
  }).lean();
  if (existing) return badRequest(res, 'Subject already exists.');

  const subject = await Subject.create({
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId,
    name,
    syllabusPdfUrl: syllabusPdfUrl || '',
    syllabusPdfName: syllabusPdfName || ''
  });

  return ok(res, { subject }, 'Subject created.');
}

export async function listMySubjects(req, res) {
  const subjects = await Subject.find({
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  })
    .sort({ createdAt: -1 })
    .lean();

  return ok(res, { subjects });
}

export async function createStudent(req, res) {
  const parsed = createStudentSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Invalid student payload.');

  const { fullName, username, password, email, phone, subjectIds } = parsed.data;

  const existing = await User.findOne({
    institutionId: req.auth.institutionId,
    username: username.toLowerCase()
  }).lean();
  if (existing) return badRequest(res, 'Username already exists.');

  const allowedSubjects = await Subject.find({
    _id: { $in: subjectIds },
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  })
    .select('_id')
    .lean();

  if (allowedSubjects.length !== subjectIds.length) {
    return badRequest(res, 'One or more subjects are invalid for this teacher.');
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
    mustChangePassword: true
  });

  const profile = await StudentProfile.create({
    userId: student._id,
    teacherId: req.auth.userId,
    subjects: allowedSubjects.map((s) => s._id)
  });

  return ok(res, {
    student: {
      id: student._id,
      fullName: student.fullName,
      username: student.username,
      email: student.email,
      phone: student.phone
    },
    profile
  }, 'Student created.');
}

export async function listMyStudents(req, res) {
  const subjectId = req.query.subjectId || '';
  const q = (req.query.q || '').trim();

  const teacherSubjects = await Subject.find({
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  })
    .select('_id')
    .lean();

  const subjectIds = teacherSubjects.map((s) => s._id);
  if (subjectIds.length === 0) return ok(res, { students: [] });

  const profileQuery = {
    teacherId: req.auth.userId,
    subjects: { $in: subjectIds }
  };
  if (subjectId) profileQuery.subjects = subjectId;

  const profiles = await StudentProfile.find(profileQuery).lean();
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

export async function deleteSubject(req, res) {
  const subjectId = req.params.subjectId;
  const subject = await Subject.findOne({
    _id: subjectId,
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  });
  if (!subject) return notFound(res, 'Subject not found.');

  await StudentProfile.updateMany(
    { teacherId: req.auth.userId },
    { $pull: { subjects: subject._id } }
  );
  await subject.deleteOne();
  return ok(res, {}, 'Subject deleted.');
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
