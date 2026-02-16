import { z } from 'zod';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { User } from '../models/User.js';
import { badRequest, created, ok } from '../utils/http.js';

const createTeacherSchema = z.object({
  fullName: z.string().min(2),
  username: z.string().min(3),
  password: z.string().min(6),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal(''))
});

export async function createTeacher(req, res) {
  const parsed = createTeacherSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Invalid teacher payload.');

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
    mustChangePassword: true
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
    role: 'teacher'
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
    User.countDocuments({ institutionId: req.auth.institutionId, role: 'teacher' }),
    User.countDocuments({ institutionId: req.auth.institutionId, role: 'student' }),
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
