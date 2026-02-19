import { z } from 'zod';
import { Attempt } from '../models/Attempt.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { Test } from '../models/Test.js';
import { User } from '../models/User.js';
import { trackAnalyticsEvent } from '../services/analytics.service.js';
import { badRequest, created, notFound, ok } from '../utils/http.js';
import { notifyUsers } from '../utils/notify.js';

const createTestSchema = z.object({
  subjectId: z.string().min(1),
  title: z.string().trim().min(2, 'Test title must be at least 2 characters.'),
  type: z.enum(['mcq', 'long', 'true_false', 'short']),
  audienceMode: z.enum(['all', 'selected']).optional(),
  selectedStudentIds: z.array(z.string().min(1)).optional(),
  sourcePdfName: z.string().trim().max(180).optional().or(z.literal('')),
  durationMinutes: z.number().int().min(1).max(180).optional(),
  questions: z.array(
    z.object({
      text: z.string().min(2),
      options: z.array(z.string()).optional(),
      correctIndex: z.number().int().optional()
    })
  ).min(1, 'At least one question is required.')
});

const submitAttemptSchema = z.object({
  answers: z.array(z.any()),
  timeSpentSeconds: z.number().int().min(0).max(4 * 60 * 60).default(0)
});

const gradeAttemptSchema = z.object({
  marks: z.number().min(0).max(100),
  feedback: z.string().trim().max(600).optional().or(z.literal(''))
});

function normalizeMcqQuestions(rawQuestions) {
  return rawQuestions.map((question, index) => {
    if (!Array.isArray(question.options) || question.options.length < 2) {
      throw new Error(`Question ${index + 1}: MCQ options must have at least 2 choices.`);
    }

    if (
      typeof question.correctIndex !== 'number' ||
      question.correctIndex < 0 ||
      question.correctIndex >= question.options.length
    ) {
      throw new Error(`Question ${index + 1}: correctIndex is invalid.`);
    }

    return {
      text: question.text,
      options: question.options,
      correctIndex: question.correctIndex
    };
  });
}

function normalizeLongQuestions(rawQuestions) {
  return rawQuestions.map((question) => ({
    text: question.text,
    options: [],
    correctIndex: undefined
  }));
}

function normalizeTrueFalseQuestions(rawQuestions) {
  return rawQuestions.map((question, index) => {
    const raw = question.correctIndex;
    const parsedIndex =
      typeof raw === 'number'
        ? raw
        : String(raw || '')
            .trim()
            .toLowerCase()
            .startsWith('t')
          ? 0
          : String(raw || '')
              .trim()
              .toLowerCase()
              .startsWith('f')
            ? 1
            : Number.NaN;

    if (!Number.isInteger(parsedIndex) || (parsedIndex !== 0 && parsedIndex !== 1)) {
      throw new Error(
        `Question ${index + 1}: correct answer must be True or False (use 1/2 or true/false).`
      );
    }

    return {
      text: question.text,
      options: ['True', 'False'],
      correctIndex: parsedIndex
    };
  });
}

export async function teacherCreateTest(req, res) {
  const parsed = createTestSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message || 'Invalid test payload.');
  }

  const payload = parsed.data;
  const audienceMode = payload.audienceMode || 'all';
  const selectedStudentIds = Array.from(
    new Set((payload.selectedStudentIds || []).map((item) => String(item || '').trim()).filter(Boolean))
  );
  const subject = await Subject.findOne({
    _id: payload.subjectId,
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  }).lean();
  if (!subject) return notFound(res, 'Subject not found.');

  if ((payload.type === 'mcq' || payload.type === 'true_false') && payload.questions.length !== 20) {
    return badRequest(res, 'MCQ and True/False tests must have exactly 20 questions.');
  }

  let questions;
  try {
    if (payload.type === 'mcq') {
      questions = normalizeMcqQuestions(payload.questions);
    } else if (payload.type === 'true_false') {
      questions = normalizeTrueFalseQuestions(payload.questions);
    } else {
      questions = normalizeLongQuestions(payload.questions);
    }
  } catch (error) {
    return badRequest(res, error.message);
  }

  const durationMinutes =
    payload.type === 'mcq' || payload.type === 'true_false'
      ? 5
      : Number(payload.durationMinutes || (payload.type === 'short' ? 30 : 60));

  const profiles = await StudentProfile.find({
    teacherId: req.auth.userId,
    subjects: payload.subjectId
  })
    .select('userId')
    .lean();

  const eligibleStudentIds = Array.from(
    new Set(
      profiles
        .map((profile) => profile.userId?.toString())
        .filter(Boolean)
    )
  );
  const eligibleStudentSet = new Set(eligibleStudentIds);

  let assignedStudentIds = eligibleStudentIds;
  if (audienceMode === 'selected') {
    if (!selectedStudentIds.length) {
      return badRequest(res, 'Select at least one student for this test.');
    }

    const invalidStudentId = selectedStudentIds.find((id) => !eligibleStudentSet.has(id));
    if (invalidStudentId) {
      return badRequest(res, 'One or more selected students are invalid for this subject.');
    }
    assignedStudentIds = selectedStudentIds;
  }

  const test = await Test.create({
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId,
    subjectId: payload.subjectId,
    title: payload.title,
    type: payload.type,
    durationMinutes,
    audienceMode,
    assignedStudentIds,
    sourcePdfName: payload.sourcePdfName || '',
    questions
  });

  await notifyUsers({
    institutionId: req.auth.institutionId,
    recipientUserIds: assignedStudentIds,
    type: 'test',
    message: `New ${payload.type.replace('_', ' ').toUpperCase()} test published: ${payload.title}`
  });

  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: req.auth.userId,
    role: 'teacher',
    eventType: 'test_published',
    stage: 'activation',
    metadata: {
      testId: test._id.toString(),
      testType: payload.type,
      subjectId: payload.subjectId,
      audienceMode,
      assignedCount: assignedStudentIds.length
    }
  });

  return created(res, { test }, 'Test published.');
}

export async function teacherListTests(req, res) {
  const subjectId = String(req.query.subjectId || '').trim();
  const query = {
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  };
  if (subjectId) query.subjectId = subjectId;

  const tests = await Test.find(query).sort({ createdAt: -1 }).lean();
  return ok(res, { tests });
}

export async function teacherListAssessments(req, res) {
  const subjectId = String(req.query.subjectId || '').trim();
  const type = String(req.query.type || '').trim();
  const status = String(req.query.status || '').trim().toLowerCase();
  const q = String(req.query.q || '').trim();

  const testQuery = {
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  };
  if (subjectId) testQuery.subjectId = subjectId;
  if (type) testQuery.type = type;

  const tests = await Test.find(testQuery)
    .select('title type subjectId totalQuestions questions')
    .lean();
  if (!tests.length) return ok(res, { assessments: [] });

  const testMap = new Map(tests.map((item) => [item._id.toString(), item]));
  const attemptQuery = {
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId,
    testId: { $in: tests.map((item) => item._id) }
  };
  if (type) attemptQuery.type = type;
  if (status === 'pending') attemptQuery.scorePercent = null;
  if (status === 'graded') attemptQuery.scorePercent = { $ne: null };

  const attempts = await Attempt.find(attemptQuery)
    .sort({ createdAt: -1 })
    .lean();
  if (!attempts.length) return ok(res, { assessments: [] });

  const students = await User.find({
    _id: { $in: attempts.map((item) => item.studentId) },
    institutionId: req.auth.institutionId,
    role: 'student'
  })
    .select('fullName username')
    .lean();
  const studentMap = new Map(students.map((item) => [item._id.toString(), item]));

  const matchedStudentIds = q
    ? new Set(
        students
          .filter((item) => {
            const label = `${item.fullName || ''} ${item.username || ''}`.toLowerCase();
            return label.includes(q.toLowerCase());
          })
          .map((item) => item._id.toString())
      )
    : null;

  const subjectIds = Array.from(
    new Set(
      tests
        .map((item) => item.subjectId)
        .filter(Boolean)
        .map((item) => item.toString())
    )
  );
  const subjects = await Subject.find({ _id: { $in: subjectIds } })
    .select('name')
    .lean();
  const subjectMap = new Map(subjects.map((item) => [item._id.toString(), item]));

  const assessments = attempts
    .filter((attempt) => {
      if (!matchedStudentIds) return true;
      return matchedStudentIds.has(attempt.studentId.toString());
    })
    .map((attempt) => {
      const test = testMap.get(attempt.testId.toString());
      const student = studentMap.get(attempt.studentId.toString());
      const subject = test?.subjectId ? subjectMap.get(test.subjectId.toString()) : null;

      return {
        id: attempt._id,
        createdAt: attempt.createdAt,
        updatedAt: attempt.updatedAt,
        type: attempt.type,
        scorePercent: attempt.scorePercent,
        assignedMarks: attempt.assignedMarks,
        evaluatedAt: attempt.evaluatedAt,
        teacherFeedback: attempt.teacherFeedback || '',
        status: attempt.scorePercent == null ? 'pending' : 'graded',
        student: student
          ? {
              id: student._id,
              fullName: student.fullName,
              username: student.username
            }
          : null,
        test: test
          ? {
              id: test._id,
              title: test.title,
              type: test.type,
              subjectId: test.subjectId,
              subjectName: subject?.name || '',
              totalQuestions: Array.isArray(test.questions) ? test.questions.length : 0
            }
          : null,
        answers: attempt.answers || []
      };
    });

  return ok(res, { assessments });
}

export async function teacherGradeAttempt(req, res) {
  const parsed = gradeAttemptSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message || 'Invalid grading payload.');
  }

  const attempt = await Attempt.findOne({
    _id: req.params.attemptId,
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  });
  if (!attempt) return notFound(res, 'Attempt not found.');

  if (attempt.type !== 'short' && attempt.type !== 'long') {
    return badRequest(res, 'Only short-form and long-form attempts can be graded here.');
  }

  attempt.assignedMarks = parsed.data.marks;
  attempt.scorePercent = parsed.data.marks;
  attempt.evaluatedBy = req.auth.userId;
  attempt.evaluatedAt = new Date();
  attempt.teacherFeedback = parsed.data.feedback || '';
  await attempt.save();

  const [test, student] = await Promise.all([
    Test.findById(attempt.testId).select('title').lean(),
    User.findById(attempt.studentId).select('fullName').lean()
  ]);

  await notifyUsers({
    institutionId: req.auth.institutionId,
    recipientUserIds: [attempt.studentId],
    type: 'assessment',
    message: `Your ${attempt.type.toUpperCase()} test "${test?.title || 'Test'}" was graded: ${parsed.data.marks}%`
  });

  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: req.auth.userId,
    role: 'teacher',
    eventType: 'attempt_graded',
    stage: 'engagement',
    metadata: {
      attemptId: attempt._id.toString(),
      testId: attempt.testId.toString(),
      studentId: attempt.studentId.toString(),
      studentName: student?.fullName || '',
      marks: parsed.data.marks
    }
  });

  return ok(
    res,
    {
      attempt: {
        id: attempt._id,
        assignedMarks: attempt.assignedMarks,
        scorePercent: attempt.scorePercent,
        evaluatedAt: attempt.evaluatedAt,
        teacherFeedback: attempt.teacherFeedback
      }
    },
    'Attempt graded successfully.'
  );
}

export async function studentTestsQueue(req, res) {
  const profile = await StudentProfile.findOne({ userId: req.auth.userId })
    .select('subjects')
    .lean();
  if (!profile || !profile.subjects?.length) return ok(res, { today: [], pending: [] });

  const tests = await Test.find({
    institutionId: req.auth.institutionId,
    subjectId: { $in: profile.subjects },
    $or: [
      { assignedStudentIds: req.auth.userId },
      { assignedStudentIds: { $exists: false } },
      { assignedStudentIds: { $size: 0 } }
    ]
  })
    .sort({ createdAt: -1 })
    .lean();

  const [subjects, teachers] = await Promise.all([
    Subject.find({ _id: { $in: tests.map((test) => test.subjectId) } })
      .select('name')
      .lean(),
    User.find({ _id: { $in: tests.map((test) => test.teacherId) } })
      .select('fullName')
      .lean()
  ]);
  const subjectMap = new Map(subjects.map((subject) => [subject._id.toString(), subject.name]));
  const teacherMap = new Map(teachers.map((teacher) => [teacher._id.toString(), teacher.fullName]));

  const attempts = await Attempt.find({
    institutionId: req.auth.institutionId,
    studentId: req.auth.userId
  })
    .select('testId')
    .lean();
  const attemptedIds = new Set(attempts.map((attempt) => attempt.testId.toString()));

  const threshold = Date.now() - 24 * 60 * 60 * 1000;
  const today = [];
  const pending = [];

  tests.forEach((test) => {
    if (attemptedIds.has(test._id.toString())) return;
    const createdAt = new Date(test.createdAt).getTime();
    const sanitizedQuestions = (test.questions || []).map((question) => ({
      text: question.text,
      options: question.options || []
    }));
    const withMeta = {
      ...test,
      questions: sanitizedQuestions,
      subjectName: subjectMap.get(test.subjectId.toString()) || '',
      teacherName: teacherMap.get(test.teacherId.toString()) || ''
    };
    if (createdAt >= threshold) today.push(withMeta);
    else pending.push(withMeta);
  });

  return ok(res, { today, pending });
}

export async function studentSubmitAttempt(req, res) {
  const testId = req.params.testId;
  const parsed = submitAttemptSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Invalid attempt payload.');

  const test = await Test.findOne({
    _id: testId,
    institutionId: req.auth.institutionId
  }).lean();
  if (!test) return notFound(res, 'Test not found.');

  const existing = await Attempt.findOne({
    institutionId: req.auth.institutionId,
    studentId: req.auth.userId,
    testId: test._id
  }).lean();
  if (existing) return badRequest(res, 'Attempt already submitted for this test.');

  const payload = parsed.data;
  let scorePercent = null;
  let correctCount = 0;
  let answers = [];

  if (test.type === 'mcq' || test.type === 'true_false') {
    answers = test.questions.map((question, index) => {
      const selectedIndex =
        typeof payload.answers[index] === 'number' ? payload.answers[index] : null;
      const isCorrect = selectedIndex === question.correctIndex;
      if (isCorrect) correctCount += 1;
      return {
        questionText: question.text,
        selectedIndex,
        correctIndex: question.correctIndex,
        isCorrect
      };
    });
    scorePercent = Math.round((correctCount / test.questions.length) * 100);
  } else {
    answers = test.questions.map((question, index) => ({
      questionText: question.text,
      answerText: String(payload.answers[index] || '').trim()
    }));
  }

  const attempt = await Attempt.create({
    institutionId: req.auth.institutionId,
    studentId: req.auth.userId,
    teacherId: test.teacherId,
    testId: test._id,
    type: test.type,
    assignedMarks: scorePercent,
    scorePercent,
    correctCount,
    totalQuestions: test.questions.length,
    timeSpentSeconds: payload.timeSpentSeconds,
    answers
  });

  const student = await User.findById(req.auth.userId).select('fullName').lean();

  const profile = await StudentProfile.findOne({ userId: req.auth.userId });
  if (profile) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let streakDays = Number(profile.streakDays || 0);
    if (!profile.lastAttemptAt) {
      streakDays = 1;
    } else {
      const last = new Date(profile.lastAttemptAt);
      const lastDay = new Date(last.getFullYear(), last.getMonth(), last.getDate());
      const diffDays = Math.floor((today - lastDay) / (24 * 60 * 60 * 1000));
      if (diffDays === 0) {
        streakDays = Math.max(1, streakDays);
      } else if (diffDays === 1) {
        streakDays += 1;
      } else {
        streakDays = 1;
      }
    }

    let xpGain = test.type === 'mcq' ? 10 : 12;
    if (scorePercent != null) xpGain += Math.max(0, Math.round(scorePercent / 20));
    if (streakDays >= 3) xpGain += 2;
    if (streakDays >= 7) xpGain += 4;

    profile.lastAttemptAt = now;
    profile.streakDays = streakDays;
    profile.longestStreak = Math.max(Number(profile.longestStreak || 0), streakDays);
    profile.usageSeconds = Number(profile.usageSeconds || 0) + Number(payload.timeSpentSeconds || 0);
    profile.xp = Number(profile.xp || 0) + xpGain;
    profile.level = Math.max(1, Math.floor(profile.xp / 120) + 1);

    const badges = new Set(profile.badges || []);
    if (streakDays >= 3) badges.add('Consistency Starter');
    if (streakDays >= 7) badges.add('Weekly Warrior');
    if (scorePercent != null && scorePercent >= 90) badges.add('High Scorer');
    if (profile.level >= 5) badges.add('Rising Scholar');

    profile.badges = [...badges];
    await profile.save();
  }

  await notifyUsers({
    institutionId: req.auth.institutionId,
    recipientUserIds: [test.teacherId],
    type: 'attempt',
    message: `${student?.fullName || 'Student'} completed test: ${test.title}`
  });

  await trackAnalyticsEvent({
    institutionId: req.auth.institutionId,
    userId: req.auth.userId,
    role: 'student',
    eventType: 'test_attempt_submitted',
    stage: 'activation',
    metadata: {
      testId: test._id.toString(),
      testType: test.type,
      scorePercent: attempt.scorePercent,
      xpTotal: profile ? Number(profile.xp || 0) : 0
    }
  });

  return created(res, { attempt }, 'Attempt submitted.');
}

export async function studentAttemptAnswerKey(req, res) {
  const attempt = await Attempt.findOne({
    _id: req.params.attemptId,
    institutionId: req.auth.institutionId,
    studentId: req.auth.userId
  }).lean();
  if (!attempt) return notFound(res, 'Attempt not found.');
  if (attempt.type !== 'mcq' && attempt.type !== 'true_false') {
    return badRequest(res, 'Answer key is only for objective attempts.');
  }

  const test = await Test.findOne({
    _id: attempt.testId,
    institutionId: req.auth.institutionId
  }).lean();
  if (!test) return notFound(res, 'Test not found.');

  const answerKey = test.questions.map((question, index) => ({
    questionNumber: index + 1,
    question: question.text,
    options: question.options,
    correctIndex: question.correctIndex,
    correctAnswer: question.options?.[question.correctIndex] || ''
  }));

  return ok(res, {
    title: test.title,
    answerKey
  });
}
