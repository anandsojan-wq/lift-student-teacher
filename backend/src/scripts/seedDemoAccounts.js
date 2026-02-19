import { connectDb } from '../config/db.js';
import { Attempt } from '../models/Attempt.js';
import { Institution } from '../models/Institution.js';
import { Resource } from '../models/Resource.js';
import { StudentProfile } from '../models/StudentProfile.js';
import { Subject } from '../models/Subject.js';
import { Test } from '../models/Test.js';
import { User } from '../models/User.js';

const DEMO = {
  institutionName: 'LIFT Demo Institute',
  institutionId: 'LIFT-DEMO-1001',
  cityCode: 'DEM',
  admin: {
    username: 'admindemo',
    password: 'Admin@12345',
    fullName: 'Demo Admin'
  },
  teacher: {
    username: 'teachdemo',
    password: 'Teacher@12345',
    fullName: 'Demo Teacher'
  },
  students: [
    { username: 'studemo', password: 'Student@12345', fullName: 'Demo Student One' },
    { username: 'studemo2', password: 'Student@12345', fullName: 'Demo Student Two' },
    { username: 'studemo3', password: 'Student@12345', fullName: 'Demo Student Three' }
  ]
};

function toDateAt(hoursAgo = 0) {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
}

function buildDemoQuestions() {
  return Array.from({ length: 20 }, (_, idx) => {
    const number = idx + 1;
    const correct = `Concept ${number}`;
    const options = [correct, `Option A${number}`, `Option B${number}`, `Option C${number}`];

    return {
      text: `Question ${number}: Choose the correct concept for demo chapter ${number}.`,
      options,
      correctIndex: 0
    };
  });
}

function buildAttemptAnswers(scoreTarget = 80) {
  const questions = 20;
  const correctCount = Math.max(0, Math.min(questions, Math.round((scoreTarget / 100) * questions)));
  return Array.from({ length: questions }, (_, idx) => {
    const isCorrect = idx < correctCount;
    return {
      questionText: `Question ${idx + 1}`,
      selectedIndex: isCorrect ? 0 : 1,
      correctIndex: 0,
      isCorrect
    };
  });
}

async function ensureInstitution() {
  let institution = await Institution.findOne({ institutionId: DEMO.institutionId });
  if (!institution) {
    institution = await Institution.create({
      name: DEMO.institutionName,
      institutionId: DEMO.institutionId,
      cityCode: DEMO.cityCode,
      planType: 'paid',
      paymentStatus: 'paid',
      trialTeacherLimit: 50,
      trialSubjectLimitPerTeacher: 20,
      studentLimit: 5000,
      isActive: true
    });
  }

  return institution;
}

async function ensureUser({ institutionId, role, username, password, fullName }) {
  const passwordHash = await User.hashPassword(password);
  const existing = await User.findOne({ institutionId, username: username.toLowerCase() });

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.fullName = fullName;
    existing.role = role;
    existing.mustChangePassword = false;
    existing.isActive = true;
    await existing.save();
    return existing;
  }

  return User.create({
    institutionId,
    role,
    username: username.toLowerCase(),
    passwordHash,
    fullName,
    email: '',
    phone: '',
    mustChangePassword: false,
    isActive: true
  });
}

async function ensureSubject({ institutionId, teacherId }) {
  let subject = await Subject.findOne({
    institutionId,
    teacherId,
    name: 'Demo Mathematics'
  });

  if (!subject) {
    subject = await Subject.create({
      institutionId,
      teacherId,
      name: 'Demo Mathematics',
      syllabusPdfUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      syllabusPdfName: 'demo-syllabus.pdf'
    });
  }

  return subject;
}

async function ensureResources({ institutionId, teacherId, subjectId }) {
  const existingCount = await Resource.countDocuments({
    institutionId,
    teacherId,
    subjectId
  });
  if (existingCount >= 3) return;

  const resources = [
    {
      resourceType: 'pdf',
      title: 'Demo Chapter Notes',
      source: 'text',
      value: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      keywords: ['demo', 'chapter', 'mathematics']
    },
    {
      resourceType: 'video',
      title: 'Demo Concept Video',
      source: 'text',
      value: 'https://www.youtube.com/watch?v=rfscVS0vtbw',
      keywords: ['video', 'concept', 'math']
    },
    {
      resourceType: 'ebook',
      title: 'Demo eBook',
      source: 'text',
      value: 'https://www.gutenberg.org/files/1342/1342-h/1342-h.htm',
      keywords: ['ebook', 'reading']
    }
  ];

  for (const resource of resources) {
    const exists = await Resource.findOne({
      institutionId,
      teacherId,
      subjectId,
      title: resource.title
    });
    if (exists) continue;

    await Resource.create({
      institutionId,
      teacherId,
      subjectId,
      ...resource
    });
  }
}

async function ensureTests({ institutionId, teacherId, subjectId }) {
  let todayTest = await Test.findOne({
    institutionId,
    teacherId,
    subjectId,
    title: 'Demo Quiz - Today'
  });

  if (!todayTest) {
    todayTest = await Test.create({
      institutionId,
      teacherId,
      subjectId,
      title: 'Demo Quiz - Today',
      type: 'mcq',
      durationMinutes: 5,
      sourcePdfName: 'demo-chapter.pdf',
      questions: buildDemoQuestions()
    });
  }

  let previousTest = await Test.findOne({
    institutionId,
    teacherId,
    subjectId,
    title: 'Demo Quiz - Previous'
  });

  if (!previousTest) {
    previousTest = await Test.create({
      institutionId,
      teacherId,
      subjectId,
      title: 'Demo Quiz - Previous',
      type: 'mcq',
      durationMinutes: 5,
      sourcePdfName: 'demo-chapter-prev.pdf',
      questions: buildDemoQuestions()
    });

    const oldDate = toDateAt(60);
    await Test.updateOne(
      { _id: previousTest._id },
      {
        $set: {
          createdAt: oldDate,
          updatedAt: oldDate
        }
      }
    );
    previousTest = await Test.findById(previousTest._id);
  }

  return { todayTest, previousTest };
}

async function ensureProfiles({ teacherId, subjectId, students }) {
  for (const student of students) {
    const existing = await StudentProfile.findOne({ userId: student._id });
    if (existing) {
      existing.teacherId = teacherId;
      if (!existing.subjects.some((id) => id.toString() === subjectId.toString())) {
        existing.subjects.push(subjectId);
      }
      if (!existing.parentEmail) existing.parentEmail = `${student.username}@parent.demo`;
      if (!existing.parentPhone) existing.parentPhone = '919876543210';
      existing.focusModeEnabled = false;
      await existing.save();
      continue;
    }

    await StudentProfile.create({
      userId: student._id,
      teacherId,
      subjects: [subjectId],
      parentEmail: `${student.username}@parent.demo`,
      parentPhone: '919876543210',
      xp: 120,
      level: 2,
      streakDays: 2,
      longestStreak: 2,
      badges: ['Starter']
    });
  }
}

async function ensureAttempts({ institutionId, teacherId, previousTestId, students }) {
  const scoreTargets = {
    studemo: 82,
    studemo2: 91,
    studemo3: 74
  };

  for (const student of students) {
    const exists = await Attempt.findOne({
      institutionId,
      studentId: student._id,
      testId: previousTestId
    });
    if (exists) continue;

    const score = scoreTargets[student.username] || 80;
    const answers = buildAttemptAnswers(score);
    const correctCount = answers.filter((item) => item.isCorrect).length;

    await Attempt.create({
      institutionId,
      studentId: student._id,
      teacherId,
      testId: previousTestId,
      type: 'mcq',
      scorePercent: Math.round((correctCount / 20) * 100),
      correctCount,
      totalQuestions: 20,
      timeSpentSeconds: 250,
      answers,
      createdAt: toDateAt(36),
      updatedAt: toDateAt(36)
    });
  }
}

async function run() {
  await connectDb();

  const institution = await ensureInstitution();

  const admin = await ensureUser({
    institutionId: institution._id,
    role: 'admin',
    ...DEMO.admin
  });

  const teacher = await ensureUser({
    institutionId: institution._id,
    role: 'teacher',
    ...DEMO.teacher
  });

  const students = [];
  for (const studentSpec of DEMO.students) {
    const student = await ensureUser({
      institutionId: institution._id,
      role: 'student',
      ...studentSpec
    });
    students.push(student);
  }

  const subject = await ensureSubject({
    institutionId: institution._id,
    teacherId: teacher._id
  });

  await ensureResources({
    institutionId: institution._id,
    teacherId: teacher._id,
    subjectId: subject._id
  });

  const { previousTest } = await ensureTests({
    institutionId: institution._id,
    teacherId: teacher._id,
    subjectId: subject._id
  });

  await ensureProfiles({
    teacherId: teacher._id,
    subjectId: subject._id,
    students
  });

  await ensureAttempts({
    institutionId: institution._id,
    teacherId: teacher._id,
    previousTestId: previousTest._id,
    students
  });

  console.log('Demo accounts ready.');
  console.log(`Institution ID: ${DEMO.institutionId}`);
  console.log(`Admin -> username: ${DEMO.admin.username}, password: ${DEMO.admin.password}`);
  console.log(`Teacher -> username: ${DEMO.teacher.username}, password: ${DEMO.teacher.password}`);
  DEMO.students.forEach((student) => {
    console.log(`Student -> username: ${student.username}, password: ${student.password}`);
  });

  process.exit(0);
}

run().catch((error) => {
  console.error('Failed to seed demo accounts:', error.message);
  process.exit(1);
});
