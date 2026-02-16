import { z } from 'zod';
import { Attempt } from '../models/Attempt.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { Test } from '../models/Test.js';
import { User } from '../models/User.js';
import { badRequest, created, notFound, ok } from '../utils/http.js';
import { notifyUsers } from '../utils/notify.js';

const createTestSchema = z.object({
  subjectId: z.string().min(1),
  title: z.string().min(2),
  type: z.enum(['mcq', 'long']),
  durationMinutes: z.number().int().min(1).max(180).optional(),
  questions: z.array(
    z.object({
      text: z.string().min(2),
      options: z.array(z.string()).optional(),
      correctIndex: z.number().int().optional()
    })
  )
});

const submitAttemptSchema = z.object({
  answers: z.array(z.any()),
  timeSpentSeconds: z.number().int().min(0).max(4 * 60 * 60).default(0)
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

export async function teacherCreateTest(req, res) {
  const parsed = createTestSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Invalid test payload.');

  const payload = parsed.data;
  const subject = await Subject.findOne({
    _id: payload.subjectId,
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId
  }).lean();
  if (!subject) return notFound(res, 'Subject not found.');

  if (payload.type === 'mcq' && payload.questions.length !== 20) {
    return badRequest(res, 'MCQ test must have exactly 20 questions.');
  }

  let questions;
  try {
    questions =
      payload.type === 'mcq'
        ? normalizeMcqQuestions(payload.questions)
        : normalizeLongQuestions(payload.questions);
  } catch (error) {
    return badRequest(res, error.message);
  }

  const durationMinutes =
    payload.type === 'mcq' ? 5 : Number(payload.durationMinutes || 60);

  const test = await Test.create({
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId,
    subjectId: payload.subjectId,
    title: payload.title,
    type: payload.type,
    durationMinutes,
    questions
  });

  const profiles = await StudentProfile.find({
    teacherId: req.auth.userId,
    subjects: payload.subjectId
  })
    .select('userId')
    .lean();

  await notifyUsers({
    institutionId: req.auth.institutionId,
    recipientUserIds: profiles.map((profile) => profile.userId),
    type: 'test',
    message: `New ${payload.type.toUpperCase()} test published: ${payload.title}`
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

export async function studentTestsQueue(req, res) {
  const profile = await StudentProfile.findOne({ userId: req.auth.userId })
    .select('subjects')
    .lean();
  if (!profile || !profile.subjects?.length) return ok(res, { today: [], pending: [] });

  const tests = await Test.find({
    institutionId: req.auth.institutionId,
    subjectId: { $in: profile.subjects }
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

  if (test.type === 'mcq') {
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
    scorePercent,
    correctCount,
    totalQuestions: test.questions.length,
    timeSpentSeconds: payload.timeSpentSeconds,
    answers
  });

  const student = await User.findById(req.auth.userId).select('fullName').lean();
  await notifyUsers({
    institutionId: req.auth.institutionId,
    recipientUserIds: [test.teacherId],
    type: 'attempt',
    message: `${student?.fullName || 'Student'} completed test: ${test.title}`
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
  if (attempt.type !== 'mcq') return badRequest(res, 'Answer key is only for MCQ attempts.');

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
