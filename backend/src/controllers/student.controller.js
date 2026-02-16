import { Attempt } from '../models/Attempt.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { Test } from '../models/Test.js';
import { User } from '../models/User.js';
import { ok } from '../utils/http.js';

export async function dashboard(req, res) {
  const [profile, attemptCount] = await Promise.all([
    StudentProfile.findOne({ userId: req.auth.userId }).populate('subjects', 'name').lean(),
    Attempt.countDocuments({ studentId: req.auth.userId })
  ]);

  return ok(res, {
    dashboard: {
      subjectCount: profile?.subjects?.length || 0,
      subjects: (profile?.subjects || []).map((subject) => ({
        id: subject._id,
        name: subject.name
      })),
      usageSeconds: profile?.usageSeconds || 0,
      attemptCount
    }
  });
}

export async function testHistory(req, res) {
  const attempts = await Attempt.find({ studentId: req.auth.userId })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const testIds = attempts.map((a) => a.testId);
  const tests = await Test.find({ _id: { $in: testIds } }).select('title subjectId type').lean();
  const testMap = new Map(tests.map((t) => [t._id.toString(), t]));

  const history = attempts.map((attempt) => ({
    ...attempt,
    test: testMap.get(attempt.testId.toString()) || null
  }));

  return ok(res, { history });
}

export async function syllabi(req, res) {
  const profile = await StudentProfile.findOne({ userId: req.auth.userId })
    .select('subjects')
    .lean();
  if (!profile?.subjects?.length) return ok(res, { syllabi: [] });

  const subjects = await Subject.find({
    _id: { $in: profile.subjects },
    institutionId: req.auth.institutionId
  })
    .select('name syllabusPdfUrl syllabusPdfName teacherId')
    .sort({ name: 1 })
    .lean();

  const teachers = await User.find({
    _id: { $in: subjects.map((subject) => subject.teacherId) }
  })
    .select('fullName')
    .lean();
  const teacherMap = new Map(teachers.map((teacher) => [teacher._id.toString(), teacher.fullName]));

  return ok(res, {
    syllabi: subjects.map((subject) => ({
      ...subject,
      teacherName: teacherMap.get(subject.teacherId.toString()) || ''
    }))
  });
}
