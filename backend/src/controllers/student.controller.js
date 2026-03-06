import { Attempt } from '../models/Attempt.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { Test } from '../models/Test.js';
import { User } from '../models/User.js';
import { resolveInlineAsset, sendInlineAsset } from '../utils/protected-file.js';
import { badRequest, notFound, ok } from '../utils/http.js';

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
      attemptCount,
      xp: profile?.xp || 0,
      level: profile?.level || 1,
      streakDays: profile?.streakDays || 0,
      longestStreak: profile?.longestStreak || 0,
      badges: profile?.badges || [],
      focusModeEnabled: Boolean(profile?.focusModeEnabled)
    }
  });
}

export async function testHistory(req, res) {
  const attempts = await Attempt.find({ studentId: req.auth.userId })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const testIds = attempts.map((a) => a.testId);
  const tests = await Test.find({ _id: { $in: testIds } })
    .select('title subjectId type answerKeyPdfUrl answerKeyPdfName')
    .lean();
  const testMap = new Map(tests.map((t) => [t._id.toString(), t]));

  const history = attempts.map((attempt) => {
    const test = testMap.get(attempt.testId.toString()) || null;
    const answerKeyAvailable = Boolean(test && (attempt.type === 'mcq' || test.answerKeyPdfUrl));

    return {
      ...attempt,
      answerKeyAvailable,
      test
    };
  });

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

  const teacherIds = subjects
    .map((subject) => (subject.teacherId ? subject.teacherId.toString() : ''))
    .filter(Boolean);

  const teachers = await User.find({
    _id: { $in: teacherIds }
  })
    .select('fullName')
    .lean();
  const teacherMap = new Map(teachers.map((teacher) => [teacher._id.toString(), teacher.fullName]));

  return ok(res, {
    syllabi: subjects.map((subject) => ({
      ...subject,
      syllabusPdfUrl: '',
      viewUrl: subject.syllabusPdfUrl ? `/api/student/syllabus/${subject._id}/view` : '',
      teacherName: subject.teacherId ? teacherMap.get(subject.teacherId.toString()) || '' : ''
    }))
  });
}

export async function studentViewSyllabus(req, res) {
  const profile = await StudentProfile.findOne({ userId: req.auth.userId })
    .select('subjects')
    .lean();
  if (!profile?.subjects?.length) return notFound(res, 'Syllabus not found.');

  const subject = await Subject.findOne({
    _id: req.params.subjectId,
    institutionId: req.auth.institutionId
  })
    .select('name syllabusPdfUrl syllabusPdfName')
    .lean();

  const isAllowedSubject = profile.subjects.some(
    (subjectId) => subjectId?.toString() === String(req.params.subjectId || '')
  );

  if (!subject || !isAllowedSubject || !subject.syllabusPdfUrl) {
    return notFound(res, 'Syllabus not found.');
  }

  try {
    const asset = await resolveInlineAsset({
      sourceUrl: subject.syllabusPdfUrl,
      fallbackFileName:
        subject.syllabusPdfName || `${String(subject.name || 'syllabus').trim() || 'syllabus'}.pdf`,
      fallbackContentType: 'application/pdf'
    });
    return sendInlineAsset(res, asset);
  } catch (error) {
    return badRequest(res, 'Unable to open this syllabus right now.');
  }
}
