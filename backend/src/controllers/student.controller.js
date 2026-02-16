import { Attempt } from '../models/Attempt.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Test } from '../models/Test.js';
import { ok } from '../utils/http.js';

export async function dashboard(req, res) {
  const [profile, attemptCount] = await Promise.all([
    StudentProfile.findOne({ userId: req.auth.userId }).populate('subjects', 'name').lean(),
    Attempt.countDocuments({ studentId: req.auth.userId })
  ]);

  return ok(res, {
    dashboard: {
      subjectCount: profile?.subjects?.length || 0,
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
