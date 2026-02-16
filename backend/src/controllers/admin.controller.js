import { z } from 'zod';
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
  const students = await User.find({
    institutionId: req.auth.institutionId,
    role: 'student'
  })
    .select('-passwordHash')
    .lean();
  return ok(res, { students });
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
