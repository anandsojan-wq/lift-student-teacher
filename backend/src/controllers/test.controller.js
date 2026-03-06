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
  type: z.enum(['mcq', 'long']),
  audienceMode: z.enum(['all', 'selected']).optional(),
  selectedStudentIds: z.array(z.string().min(1)).optional(),
  sourcePdfName: z.string().trim().max(180).optional().or(z.literal('')),
  questionPdfUrl: z.string().trim().optional().or(z.literal('')),
  questionPdfName: z.string().trim().max(180).optional().or(z.literal('')),
  answerKeyPdfUrl: z.string().trim().optional().or(z.literal('')),
  answerKeyPdfName: z.string().trim().max(180).optional().or(z.literal('')),
  mcqCorrectMark: z.number().min(0.01).max(100).optional(),
  mcqWrongMark: z.number().min(-100).max(0).optional(),
  durationMinutes: z.number().int().min(1).max(180).optional(),
  scheduledStartAt: z.string().trim().optional().or(z.literal('')),
  scheduledEndAt: z.string().trim().optional().or(z.literal('')),
  questions: z.array(
    z.object({
      text: z.string().min(1),
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
    const safeText = String(question.text || '').trim();
    if (!safeText) {
      throw new Error(`Question ${index + 1}: question text is required.`);
    }
    const safeOptions = question.options.map((option) => String(option || '').trim());
    if (safeOptions.some((option) => !option)) {
      throw new Error(`Question ${index + 1}: all options are required.`);
    }

    if (
      typeof question.correctIndex !== 'number' ||
      question.correctIndex < 0 ||
      question.correctIndex >= safeOptions.length
    ) {
      throw new Error(`Question ${index + 1}: correctIndex is invalid.`);
    }

    return {
      text: safeText,
      options: safeOptions,
      correctIndex: question.correctIndex
    };
  });
}

function normalizeLongQuestions(rawQuestions) {
  return rawQuestions.map((question, index) => {
    const safeText = String(question.text || '').trim();
    if (!safeText) {
      throw new Error(`Question ${index + 1}: question text is required.`);
    }
    return {
      text: safeText,
      options: [],
      correctIndex: undefined
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
    institutionId: req.auth.institutionId
  }).lean();
  if (!subject) return notFound(res, 'Subject not found.');

  if (payload.type === 'mcq' && (payload.questions.length < 1 || payload.questions.length > 100)) {
    return badRequest(res, 'MCQ tests must have between 1 and 100 questions.');
  }

  const questionPdfUrl = String(payload.questionPdfUrl || '').trim();
  const questionPdfName = String(payload.questionPdfName || '').trim();
  const answerKeyPdfUrl = String(payload.answerKeyPdfUrl || '').trim();
  const answerKeyPdfName = String(payload.answerKeyPdfName || '').trim();
  const isPdfAuthoredTest = Boolean(String(payload.sourcePdfName || '').trim() || questionPdfUrl);
  if (isPdfAuthoredTest || payload.type === 'long') {
    if (!questionPdfUrl) {
      return badRequest(res, 'Questions PDF is required for PDF-based tests.');
    }
    if (!answerKeyPdfUrl) {
      return badRequest(res, 'Answer Key PDF is required for PDF-based tests.');
    }
  }

  let questions;
  try {
    if (payload.type === 'mcq') {
      questions = normalizeMcqQuestions(payload.questions);
    } else {
      questions = normalizeLongQuestions(payload.questions);
    }
  } catch (error) {
    return badRequest(res, error.message);
  }

  const durationMinutes =
    payload.type === 'mcq'
      ? Number(payload.durationMinutes || 5)
      : Number(payload.durationMinutes || 60);
  const mcqCorrectMark = payload.type === 'mcq' ? Number(payload.mcqCorrectMark ?? 1) : 1;
  const mcqWrongMark = payload.type === 'mcq' ? Number(payload.mcqWrongMark ?? 0) : 0;

  if (!Number.isFinite(mcqCorrectMark) || mcqCorrectMark <= 0) {
    return badRequest(res, 'MCQ correct-answer mark must be greater than 0.');
  }
  if (!Number.isFinite(mcqWrongMark) || mcqWrongMark > 0) {
    return badRequest(res, 'MCQ wrong-answer mark must be 0 or negative.');
  }

  const scheduleStartRaw = String(payload.scheduledStartAt || '').trim();
  const scheduleEndRaw = String(payload.scheduledEndAt || '').trim();
  let scheduledStartAt = null;
  let scheduledEndAt = null;

  if ((scheduleStartRaw && !scheduleEndRaw) || (!scheduleStartRaw && scheduleEndRaw)) {
    return badRequest(res, 'Provide both schedule start and end time.');
  }

  if (scheduleStartRaw && scheduleEndRaw) {
    const parsedStart = new Date(scheduleStartRaw);
    const parsedEnd = new Date(scheduleEndRaw);
    const startMs = parsedStart.getTime();
    const endMs = parsedEnd.getTime();

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return badRequest(res, 'Invalid scheduled test date/time.');
    }

    if (endMs <= startMs) {
      return badRequest(res, 'Scheduled end time must be after start time.');
    }

    const availableWindowMinutes = Math.floor((endMs - startMs) / 60_000);
    if (availableWindowMinutes < durationMinutes) {
      return badRequest(
        res,
        `Schedule window must be at least ${durationMinutes} minutes for this test.`
      );
    }

    scheduledStartAt = parsedStart;
    scheduledEndAt = parsedEnd;
  }

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
    scheduledStartAt,
    scheduledEndAt,
    audienceMode,
    assignedStudentIds,
    sourcePdfName: payload.sourcePdfName || '',
    questionPdfUrl,
    questionPdfName: questionPdfName || payload.sourcePdfName || '',
    answerKeyPdfUrl,
    answerKeyPdfName,
    mcqCorrectMark,
    mcqWrongMark,
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

export async function teacherLiveTestsStats(req, res) {
  const now = new Date();
  const nowMs = now.getTime();

  const liveTests = await Test.find({
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId,
    scheduledStartAt: { $ne: null, $lte: now },
    scheduledEndAt: { $ne: null, $gte: now }
  })
    .sort({ scheduledStartAt: 1 })
    .lean();

  if (!liveTests.length) return ok(res, { liveTests: [] });

  const subjectIds = Array.from(
    new Set(
      liveTests
        .map((item) => item.subjectId?.toString())
        .filter(Boolean)
    )
  );
  const subjectDocs = await Subject.find({ _id: { $in: subjectIds } }).select('name').lean();
  const subjectMap = new Map(subjectDocs.map((item) => [item._id.toString(), item.name]));

  const profileDocs = await StudentProfile.find({
    teacherId: req.auth.userId,
    subjects: { $in: subjectIds }
  })
    .select('userId subjects')
    .lean();

  const profileBySubject = new Map();
  profileDocs.forEach((profile) => {
    const userId = profile.userId?.toString();
    if (!userId) return;
    (profile.subjects || []).forEach((subjectId) => {
      const key = subjectId?.toString();
      if (!key) return;
      if (!profileBySubject.has(key)) profileBySubject.set(key, new Set());
      profileBySubject.get(key).add(userId);
    });
  });

  const assignedByTest = new Map();
  liveTests.forEach((test) => {
    const selected = (test.assignedStudentIds || []).map((item) => item?.toString()).filter(Boolean);
    const assigned =
      test.audienceMode === 'selected' && selected.length
        ? selected
        : Array.from(profileBySubject.get(test.subjectId?.toString()) || []);
    assignedByTest.set(test._id.toString(), assigned);
  });

  const allStudentIds = Array.from(
    new Set(
      [...assignedByTest.values()].flat().filter(Boolean)
    )
  );
  const studentDocs = await User.find({
    _id: { $in: allStudentIds },
    institutionId: req.auth.institutionId,
    role: 'student'
  })
    .select('fullName username')
    .lean();
  const studentMap = new Map(studentDocs.map((item) => [item._id.toString(), item]));

  const attempts = await Attempt.find({
    institutionId: req.auth.institutionId,
    teacherId: req.auth.userId,
    testId: { $in: liveTests.map((item) => item._id) }
  })
    .select('testId studentId createdAt scorePercent')
    .lean();

  const attemptByTestStudent = new Map();
  attempts.forEach((attempt) => {
    const key = `${attempt.testId?.toString()}:${attempt.studentId?.toString()}`;
    if (!attemptByTestStudent.has(key)) {
      attemptByTestStudent.set(key, attempt);
      return;
    }
    const existing = attemptByTestStudent.get(key);
    if (new Date(attempt.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      attemptByTestStudent.set(key, attempt);
    }
  });

  const response = liveTests.map((test) => {
    const testId = test._id.toString();
    const assignedStudents = assignedByTest.get(testId) || [];
    const rows = assignedStudents.map((studentId) => {
      const student = studentMap.get(studentId);
      const attempt = attemptByTestStudent.get(`${testId}:${studentId}`);
      return {
        studentId,
        fullName: student?.fullName || 'Unknown Student',
        username: student?.username || '',
        attended: Boolean(attempt),
        submittedAt: attempt?.createdAt || null,
        scorePercent: attempt?.scorePercent ?? null
      };
    });

    const attendedCount = rows.filter((item) => item.attended).length;
    const pendingCount = rows.length - attendedCount;
    const endAtMs = test.scheduledEndAt ? new Date(test.scheduledEndAt).getTime() : nowMs;
    const remainingMinutes = Math.max(0, Math.ceil((endAtMs - nowMs) / 60000));

    return {
      id: test._id,
      title: test.title,
      type: test.type,
      subjectId: test.subjectId,
      subjectName: subjectMap.get(test.subjectId?.toString()) || '',
      scheduledStartAt: test.scheduledStartAt,
      scheduledEndAt: test.scheduledEndAt,
      durationMinutes: test.durationMinutes,
      audienceMode: test.audienceMode || 'all',
      totalAssigned: rows.length,
      attendedCount,
      pendingCount,
      remainingMinutes,
      students: rows
    };
  });

  return ok(res, { liveTests: response });
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

  if (attempt.type !== 'long') {
    return badRequest(res, 'Only PDF-upload test attempts can be graded here.');
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
    message: `Your ${attempt.type === 'mcq' ? 'MCQ' : 'PDF Upload'} test "${test?.title || 'Test'}" was graded: ${parsed.data.marks}%`
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
    const now = Date.now();
    const startAtMs = test.scheduledStartAt ? new Date(test.scheduledStartAt).getTime() : Number.NaN;
    const endAtMs = test.scheduledEndAt ? new Date(test.scheduledEndAt).getTime() : Number.NaN;
    const hasScheduleWindow = Number.isFinite(startAtMs) && Number.isFinite(endAtMs);
    let canStart = true;
    let windowStatus = 'none';

    if (hasScheduleWindow) {
      if (now < startAtMs) {
        canStart = false;
        windowStatus = 'upcoming';
      } else if (now > endAtMs) {
        canStart = false;
        windowStatus = 'closed';
      } else {
        canStart = true;
        windowStatus = 'open';
      }
    }

    const sanitizedQuestions = (test.questions || []).map((question) => ({
      text: question.text,
      options: question.options || []
    }));
    const withMeta = {
      ...test,
      questions: sanitizedQuestions,
      subjectName: subjectMap.get(test.subjectId.toString()) || '',
      teacherName: teacherMap.get(test.teacherId.toString()) || '',
      canStart,
      windowStatus
    };

    if (hasScheduleWindow) {
      if (windowStatus === 'closed') pending.push(withMeta);
      else today.push(withMeta);
      return;
    }

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

  if (test.scheduledStartAt && test.scheduledEndAt) {
    const startAtMs = new Date(test.scheduledStartAt).getTime();
    const endAtMs = new Date(test.scheduledEndAt).getTime();
    const now = Date.now();

    if (Number.isFinite(startAtMs) && Number.isFinite(endAtMs) && (now < startAtMs || now > endAtMs)) {
      return badRequest(res, 'This test can only be attended within its scheduled window.');
    }
  }

  const existing = await Attempt.findOne({
    institutionId: req.auth.institutionId,
    studentId: req.auth.userId,
    testId: test._id
  }).lean();
  if (existing) return badRequest(res, 'Attempt already submitted for this test.');

  const payload = parsed.data;
  let scorePercent = null;
  let correctCount = 0;
  let wrongCount = 0;
  let assignedMarks = null;
  let answers = [];

  if (test.type === 'mcq') {
    const correctMark = Number(test.mcqCorrectMark ?? 1);
    const wrongMark = Number(test.mcqWrongMark ?? 0);

    answers = test.questions.map((question, index) => {
      const selectedIndex =
        typeof payload.answers[index] === 'number' ? payload.answers[index] : null;
      const isCorrect = selectedIndex === question.correctIndex;
      if (isCorrect) correctCount += 1;
      else if (selectedIndex != null) wrongCount += 1;
      return {
        questionText: question.text,
        selectedIndex,
        correctIndex: question.correctIndex,
        isCorrect
      };
    });
    assignedMarks = Number((correctCount * correctMark + wrongCount * wrongMark).toFixed(2));
    const maxMarks = Number((test.questions.length * correctMark).toFixed(2));
    const rawPercent = maxMarks > 0 ? (assignedMarks / maxMarks) * 100 : 0;
    scorePercent = Math.max(0, Math.min(100, Math.round(rawPercent)));
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
    assignedMarks,
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

  const test = await Test.findOne({
    _id: attempt.testId,
    institutionId: req.auth.institutionId
  }).lean();
  if (!test) return notFound(res, 'Test not found.');

  if (test.answerKeyPdfUrl) {
    return ok(res, {
      title: test.title,
      source: 'pdf',
      downloadUrl: test.answerKeyPdfUrl,
      fileName: test.answerKeyPdfName || `${test.title || 'test'}-answer-key.pdf`
    });
  }

  if (attempt.type !== 'mcq') {
    return badRequest(res, 'Answer key is not available for this attempt yet.');
  }

  const answerKey = test.questions.map((question, index) => ({
    questionNumber: index + 1,
    question: question.text,
    options: question.options,
    correctIndex: question.correctIndex,
    correctAnswer: question.options?.[question.correctIndex] || ''
  }));

  return ok(res, {
    title: test.title,
    source: 'inline',
    answerKey
  });
}
