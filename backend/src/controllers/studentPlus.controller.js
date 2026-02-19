import { z } from 'zod';
import { Attempt } from '../models/Attempt.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { Test } from '../models/Test.js';
import { User } from '../models/User.js';
import { badRequest, ok } from '../utils/http.js';

export async function studentLeaderboard(req, res) {
  const subjectId = String(req.query.subjectId || '').trim();

  const subjectFilter = {
    institutionId: req.auth.institutionId
  };
  if (subjectId) subjectFilter._id = subjectId;

  const subjects = await Subject.find(subjectFilter).select('_id name').lean();
  const subjectIds = subjects.map((item) => item._id);
  if (!subjectIds.length) {
    return ok(res, { leaderboard: [], myRank: null, subjectOptions: [] });
  }

  const tests = await Test.find({
    institutionId: req.auth.institutionId,
    subjectId: { $in: subjectIds }
  })
    .select('_id subjectId')
    .lean();

  const testIds = tests.map((test) => test._id);
  if (!testIds.length) {
    return ok(res, {
      leaderboard: [],
      myRank: null,
      subjectOptions: subjects.map((item) => ({ id: item._id, name: item.name }))
    });
  }

  const attempts = await Attempt.find({
    institutionId: req.auth.institutionId,
    testId: { $in: testIds },
    scorePercent: { $ne: null }
  })
    .select('studentId scorePercent')
    .lean();

  const scoreMap = new Map();
  attempts.forEach((attempt) => {
    const studentKey = attempt.studentId.toString();
    const current = scoreMap.get(studentKey) || {
      studentId: studentKey,
      total: 0,
      count: 0,
      best: 0
    };

    const score = Number(attempt.scorePercent || 0);
    current.total += score;
    current.count += 1;
    current.best = Math.max(current.best, score);

    scoreMap.set(studentKey, current);
  });

  const ranked = [...scoreMap.values()]
    .map((item) => ({
      studentId: item.studentId,
      avgScore: Math.round(item.total / Math.max(item.count, 1)),
      attempts: item.count,
      bestScore: item.best
    }))
    .sort((a, b) => {
      if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
      return b.attempts - a.attempts;
    })
    .slice(0, 100);

  const users = await User.find({
    _id: { $in: ranked.map((item) => item.studentId) },
    role: 'student'
  })
    .select('fullName username')
    .lean();
  const userMap = new Map(users.map((item) => [item._id.toString(), item]));

  const leaderboard = ranked.map((item, index) => ({
    rank: index + 1,
    studentId: item.studentId,
    fullName: userMap.get(item.studentId)?.fullName || 'Student',
    username: userMap.get(item.studentId)?.username || '',
    avgScore: item.avgScore,
    attempts: item.attempts,
    bestScore: item.bestScore
  }));

  const myRow = leaderboard.find((item) => item.studentId === req.auth.userId) || null;

  return ok(res, {
    leaderboard,
    myRank: myRow,
    subjectOptions: subjects.map((item) => ({ id: item._id, name: item.name }))
  });
}

const focusModeSchema = z.object({
  enabled: z.boolean()
});

export async function studentFocusMode(req, res) {
  const parsed = focusModeSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Invalid focus mode payload.');

  const profile = await StudentProfile.findOne({ userId: req.auth.userId });
  if (!profile) return badRequest(res, 'Student profile not found.');

  profile.focusModeEnabled = parsed.data.enabled;
  await profile.save();

  return ok(
    res,
    {
      focusModeEnabled: profile.focusModeEnabled
    },
    `Focus mode ${profile.focusModeEnabled ? 'enabled' : 'disabled'}.`
  );
}
