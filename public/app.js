const app = document.getElementById('app');

const STORAGE_KEY = 'lift_working_prototype_v1';
const MCQ_QUESTION_LIMIT = 20;
const MCQ_DURATION_MINUTES = 5;
const LONG_TEST_DURATIONS = [60, 90, 120];

const runtime = {
  activeStudentSessionStart: null,
  activeTestSession: null,
  activeTimerId: null,
  visibilityHandlerBound: false,
  resourceSearchDebounceId: null
};

if (typeof window !== 'undefined' && window.pdfjsLib?.GlobalWorkerOptions) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function dateOnly(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

function isToday(iso) {
  return dateOnly(iso) === dateOnly(nowIso());
}

function readableDate(iso) {
  return new Date(iso).toLocaleString();
}

function sanitizeValue(value) {
  return value.trim().replace(/\s+/g, ' ');
}

function generateTempPassword() {
  return Math.random().toString(36).slice(2, 10);
}

function phoneToWhatsapp(phone) {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  return digits.length === 10 ? `91${digits}` : digits;
}

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'U';
  return parts
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function csvEscape(value) {
  const safe = String(value ?? '');
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function createTeacherWorkspace(displayName) {
  return {
    displayName,
    subjects: [],
    subjectSyllabi: {},
    studentIds: [],
    testIds: [],
    resourceLibrary: [],
    uploads: {
      guide: '',
      syllabus: '',
      resources: ''
    },
    draftTest: {
      type: 'mcq',
      title: '',
      subject: '',
      durationMinutes: 60,
      mcqSourcePdfName: '',
      mcqQuestions: []
    }
  };
}

function defaultState() {
  return {
    version: 1,
    trialLimits: {
      teacherAccounts: 5,
      subjectsPerTeacher: 5
    },
    auth: {
      admin: {
        institutionId: 'LIFT-TRIAL-1001',
        password: 'admin123'
      },
      teachers: [],
      currentRole: null,
      currentTeacherId: null,
      currentStudentId: null
    },
    teachers: {},
    students: {},
    tests: {},
    messages: [],
    alerts: [],
    feedback: {
      adminTeacherStatus: '',
      teacherActionStatus: '',
      adminSearchQuery: '',
      adminView: 'overview',
      teacherView: 'overview',
      studentView: 'overview',
      adminSubjectFilter: 'all',
      teacherStudentSearch: '',
      teacherSubjectFilter: 'all',
      adminSelectedStudentId: '',
      teacherSelectedStudentId: '',
      studentActiveSubject: '',
      studentSelectedTeacherId: '',
      studentResourceSearch: '',
      studentActiveVideoId: '',
      studentShowNotifications: false,
      teacherShowNotifications: false
    }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) {
      return defaultState();
    }

    parsed.auth = parsed.auth || defaultState().auth;
    parsed.auth.teachers = Array.isArray(parsed.auth.teachers)
      ? parsed.auth.teachers
      : [];

    parsed.teachers = parsed.teachers || {};
    parsed.students = parsed.students || {};
    parsed.tests = parsed.tests || {};
    parsed.messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    parsed.alerts = Array.isArray(parsed.alerts) ? parsed.alerts : [];
    parsed.teachers = parsed.teachers || {};
    parsed.feedback = {
      ...defaultState().feedback,
      ...(parsed.feedback || {})
    };

    parsed.auth.teachers = parsed.auth.teachers.map((teacher) => ({
      email: '',
      phone: '',
      profileImage: '',
      mustChangePassword: false,
      ...teacher
    }));

    Object.values(parsed.students).forEach((student) => {
      student.subjects =
        Array.isArray(student.subjects) && student.subjects.length
          ? student.subjects.filter(Boolean)
          : student.subject
            ? [student.subject]
            : [];
      student.subject = student.subject || student.subjects[0] || '';
      student.profileImage = student.profileImage || '';
      student.mustChangePassword = Boolean(student.mustChangePassword);
      student.videoNotes =
        student.videoNotes && typeof student.videoNotes === 'object'
          ? student.videoNotes
          : {};
    });

    Object.values(parsed.teachers).forEach((workspace) => {
      workspace.subjects = Array.isArray(workspace.subjects) ? workspace.subjects : [];
      workspace.subjectSyllabi =
        workspace.subjectSyllabi && typeof workspace.subjectSyllabi === 'object'
          ? workspace.subjectSyllabi
          : {};
      workspace.resourceLibrary = Array.isArray(workspace.resourceLibrary)
        ? workspace.resourceLibrary
        : [];
      workspace.resourceLibrary = workspace.resourceLibrary.map((resource) => {
        const normalized = {
          resourceKeywords: [],
          ...resource
        };
        normalized.resourceSearchText =
          normalized.resourceSearchText || buildResourceSearchText(normalized);
        return normalized;
      });
      workspace.draftTest = workspace.draftTest || {
        type: 'mcq',
        title: '',
        subject: '',
        durationMinutes: 60,
        mcqSourcePdfName: '',
        mcqQuestions: []
      };
      workspace.draftTest.mcqSourcePdfName = workspace.draftTest.mcqSourcePdfName || '';
    });

    return parsed;
  } catch (error) {
    return defaultState();
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function brandLogo(compact = false) {
  return `
    <div class="brand-shell ${compact ? 'compact' : ''}">
      <div class="logo-wrap ${compact ? 'compact' : ''}">
        <img
          src="/logo.png"
          alt="LIFT Educations logo"
          class="company-logo"
          onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';"
        />
        <div class="logo-fallback">LIFT</div>
      </div>
      <div class="brand-copy">
        <p class="brand-name">LIFT Educations</p>
        <p class="brand-sub">Smart Learning Platform</p>
      </div>
    </div>
  `;
}

function teacherRecords() {
  return state.auth.teachers;
}

function studentRecords() {
  return Object.values(state.students);
}

function testRecords() {
  return Object.values(state.tests);
}

function getTeacherById(teacherId) {
  return teacherRecords().find((teacher) => teacher.id === teacherId) || null;
}

function getTeacherByUsername(username) {
  return teacherRecords().find((teacher) => teacher.username === username) || null;
}

function getStudentByUsername(username) {
  return studentRecords().find((student) => student.username === username) || null;
}

function getTeacherWorkspace(teacherId) {
  const teacher = getTeacherById(teacherId);
  if (!teacher) return null;

  if (!state.teachers[teacherId]) {
    state.teachers[teacherId] = createTeacherWorkspace(teacher.fullName);
  }

  const workspace = state.teachers[teacherId];
  workspace.resourceLibrary = Array.isArray(workspace.resourceLibrary)
    ? workspace.resourceLibrary
    : [];
  workspace.resourceLibrary = workspace.resourceLibrary.map((resource) => {
    const normalized = {
      resourceKeywords: [],
      ...resource
    };
    normalized.resourceSearchText =
      normalized.resourceSearchText || buildResourceSearchText(normalized);
    return normalized;
  });
  workspace.subjectSyllabi =
    workspace.subjectSyllabi && typeof workspace.subjectSyllabi === 'object'
      ? workspace.subjectSyllabi
      : {};
  workspace.subjects = Array.isArray(workspace.subjects) ? workspace.subjects : [];
  workspace.studentIds = Array.isArray(workspace.studentIds) ? workspace.studentIds : [];
  workspace.testIds = Array.isArray(workspace.testIds) ? workspace.testIds : [];
  workspace.draftTest = workspace.draftTest || {
    type: 'mcq',
    title: '',
    subject: '',
    durationMinutes: 60,
    mcqSourcePdfName: '',
    mcqQuestions: []
  };
  workspace.draftTest.mcqSourcePdfName = workspace.draftTest.mcqSourcePdfName || '';

  return workspace;
}

function getCurrentTeacher() {
  if (!state.auth.currentTeacherId) return null;
  return getTeacherById(state.auth.currentTeacherId);
}

function getCurrentStudent() {
  if (!state.auth.currentStudentId) return null;
  return state.students[state.auth.currentStudentId] || null;
}

function getTeacherStudents(teacherId) {
  return studentRecords().filter((student) => student.teacherId === teacherId);
}

function getTeacherTests(teacherId) {
  return testRecords().filter((test) => test.teacherId === teacherId);
}

function normalizeMessage(message) {
  if (message.fromRole && message.toRole) {
    return message;
  }

  return {
    ...message,
    fromRole: 'student',
    fromId: message.studentId,
    toRole: 'teacher',
    toId: message.teacherId
  };
}

function getConversationMessages(studentId, teacherId) {
  return state.messages
    .map(normalizeMessage)
    .filter(
      (message) =>
        message.studentId === studentId &&
        message.teacherId === teacherId
    )
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function sendMessage({
  fromRole,
  fromId,
  toRole,
  toId,
  studentId,
  teacherId,
  text
}) {
  const payload = sanitizeValue(text);
  if (!payload) {
    return false;
  }

  state.messages.push({
    id: uid('msg'),
    fromRole,
    fromId,
    toRole,
    toId,
    studentId,
    teacherId,
    text: payload,
    createdAt: nowIso()
  });

  return true;
}

function pushNotification({
  recipientRole,
  recipientId = '',
  type = 'info',
  message,
  studentId = '',
  teacherId = '',
  testId = ''
}) {
  state.alerts.unshift({
    id: uid('alert'),
    recipientRole,
    recipientId,
    type,
    message,
    studentId,
    teacherId,
    testId,
    createdAt: nowIso(),
    read: false
  });
}

function getNotifications(recipientRole, recipientId = '') {
  return state.alerts.filter((alert) => {
    if (alert.recipientRole !== recipientRole) return false;
    if (!recipientId) return true;
    return alert.recipientId === recipientId;
  });
}

function unreadNotificationCount(recipientRole, recipientId = '') {
  return getNotifications(recipientRole, recipientId).filter((alert) => !alert.read).length;
}

function markNotificationsRead(recipientRole, recipientId = '') {
  state.alerts.forEach((alert) => {
    const roleMatches = alert.recipientRole === recipientRole;
    const idMatches = !recipientId || alert.recipientId === recipientId;
    if (roleMatches && idMatches) {
      alert.read = true;
    }
  });
}

function attemptsForStudent(student) {
  return (student.attempts || [])
    .slice()
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

function deleteStudentRecord(studentId) {
  const student = state.students[studentId];
  if (!student) return false;

  const workspace = getTeacherWorkspace(student.teacherId);
  if (workspace) {
    workspace.studentIds = workspace.studentIds.filter((id) => id !== studentId);
  }

  state.messages = state.messages
    .map(normalizeMessage)
    .filter((message) => message.studentId !== studentId);

  state.alerts = state.alerts.filter((alert) => alert.studentId !== studentId);

  if (state.auth.currentStudentId === studentId) {
    state.auth.currentStudentId = null;
    runtime.activeStudentSessionStart = null;
  }

  if (state.feedback.adminSelectedStudentId === studentId) {
    state.feedback.adminSelectedStudentId = '';
  }
  if (state.feedback.teacherSelectedStudentId === studentId) {
    state.feedback.teacherSelectedStudentId = '';
  }

  delete state.students[studentId];
  return true;
}

function deleteResourceRecord(teacherId, resourceId) {
  const workspace = getTeacherWorkspace(teacherId);
  if (!workspace) return false;

  const before = workspace.resourceLibrary.length;
  workspace.resourceLibrary = workspace.resourceLibrary.filter(
    (resource) => resource.id !== resourceId
  );
  return workspace.resourceLibrary.length !== before;
}

function subjectList() {
  return Array.from(
    new Set(studentRecords().flatMap((student) => studentSubjects(student)).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
}

function scoreHistoryMarkup(student) {
  const attempts = attemptsForStudent(student);
  if (!attempts.length) {
    return '<p class="muted">No test attempts yet.</p>';
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Submitted</th>
            <th>Type</th>
            <th>Score</th>
            <th>Time Spent</th>
          </tr>
        </thead>
        <tbody>
          ${attempts
            .map((attempt) => `
              <tr>
                <td>${readableDate(attempt.submittedAt)}</td>
                <td>${attempt.type.toUpperCase()}</td>
                <td>${attempt.scorePercent == null ? '-' : `${attempt.scorePercent}%`}</td>
                <td>${Math.round((attempt.timeSpentSeconds || 0) / 60)} mins</td>
              </tr>
            `)
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function displayNameForRole(role, id, fallback = '') {
  if (role === 'student') {
    const student = state.students[id];
    return student ? `${student.firstName} ${student.lastName}` : fallback || 'Student';
  }
  if (role === 'teacher') {
    const teacher = getTeacherById(id);
    return teacher ? teacher.fullName : fallback || 'Teacher';
  }
  return fallback || 'Admin';
}

function profileImageForRole(role, id) {
  if (role === 'student') {
    return state.students[id]?.profileImage || '';
  }
  if (role === 'teacher') {
    return getTeacherById(id)?.profileImage || '';
  }
  return '';
}

function avatarMarkup(role, id, name) {
  const image = profileImageForRole(role, id);
  if (image) {
    return `<span class="avatar"><img src="${image}" alt="${name}" /></span>`;
  }
  return `<span class="avatar fallback">${initials(name)}</span>`;
}

function messageSenderLabel(message) {
  const normalized = normalizeMessage(message);
  if (normalized.fromRole === 'student') {
    const student = state.students[normalized.studentId];
    return student ? `${student.firstName} ${student.lastName}` : 'Student';
  }
  if (normalized.fromRole === 'teacher') {
    const teacher = getTeacherById(normalized.teacherId);
    return teacher ? teacher.fullName : 'Teacher';
  }
  return 'Admin';
}

function resourceAcceptForType(resourceType) {
  switch (resourceType) {
    case 'pdf':
      return '.pdf,application/pdf';
    case 'ebook':
      return '.epub,.mobi,.azw3,.pdf,application/pdf';
    case 'video':
      return '';
    case 'link':
      return '';
    default:
      return '.pdf,.epub,.mobi,.azw3,application/pdf';
  }
}

function isWithinLastHours(iso, hours) {
  const createdAt = new Date(iso).getTime();
  if (Number.isNaN(createdAt)) return false;
  const ageMs = Date.now() - createdAt;
  return ageMs >= 0 && ageMs < hours * 60 * 60 * 1000;
}

function studentSubjects(student) {
  if (Array.isArray(student.subjects) && student.subjects.length) {
    return student.subjects.filter(Boolean);
  }
  return student.subject ? [student.subject] : [];
}

function studentHasSubject(student, subject) {
  if (!subject) return false;
  return studentSubjects(student).includes(subject);
}

function youtubeVideoId(rawUrl) {
  const value = sanitizeValue(String(rawUrl || ''));
  if (!value) return '';

  try {
    const normalizedValue = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const parsed = new URL(normalizedValue);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    let videoId = '';

    if (host === 'youtu.be') {
      videoId = parsed.pathname.replace('/', '');
    } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if (parsed.pathname === '/watch') {
        videoId = parsed.searchParams.get('v') || '';
      } else if (parsed.pathname.startsWith('/embed/')) {
        videoId = parsed.pathname.split('/')[2] || '';
      } else if (parsed.pathname.startsWith('/shorts/')) {
        videoId = parsed.pathname.split('/')[2] || '';
      }
    }

    return videoId || '';
  } catch (error) {
    return '';
  }
}

function youtubeEmbedUrl(rawUrl) {
  const videoId = youtubeVideoId(rawUrl);
  if (!videoId) return '';
  const originParam =
    typeof window !== 'undefined' && window.location?.origin
      ? `&origin=${encodeURIComponent(window.location.origin)}`
      : '';
  return `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&controls=0&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1&loop=1&playlist=${videoId}${originParam}`;
}

function youtubeThumbnailUrl(rawUrl) {
  const videoId = youtubeVideoId(rawUrl);
  if (!videoId) return '';
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function isYoutubeUrl(rawUrl) {
  return Boolean(youtubeVideoId(rawUrl));
}

const SEARCH_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'about', 'your',
  'have', 'has', 'was', 'were', 'are', 'is', 'to', 'of', 'in', 'on', 'at', 'an', 'a'
]);

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSearchQuery(value) {
  return normalizeSearchText(value)
    .split(' ')
    .filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token));
}

function extractKeywordsFromText(text, limit = 30) {
  const tokens = tokenizeSearchQuery(text);
  const frequency = new Map();
  tokens.forEach((token) => {
    frequency.set(token, (frequency.get(token) || 0) + 1);
  });
  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

function buildResourceSearchText(resource) {
  const parts = [
    resource.resourceValue,
    resource.subject,
    resource.resourceType,
    ...(Array.isArray(resource.resourceKeywords) ? resource.resourceKeywords : [])
  ];
  return normalizeSearchText(parts.join(' '));
}

function rankResourcesByQuery(resources, query) {
  const sortedByDate = resources
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const normalizedQuery = normalizeSearchText(query);
  const tokens = tokenizeSearchQuery(query);
  if (!normalizedQuery) {
    return sortedByDate;
  }

  return sortedByDate
    .map((resource) => {
      const corpus = resource.resourceSearchText || buildResourceSearchText(resource);
      let score = 0;

      if (corpus.includes(normalizedQuery)) {
        score += 120;
      }

      tokens.forEach((token) => {
        if (corpus.includes(token)) score += 15;
        if (resource.subject && normalizeSearchText(resource.subject).includes(token)) score += 8;
      });

      const filename = normalizeSearchText(resource.resourceValue);
      if (normalizedQuery && filename.startsWith(normalizedQuery)) score += 12;
      if (resource.resourceType === 'pdf') score += 3;

      return { resource, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.resource);
}

function studentAttemptsForTest(student, testId) {
  return (student.attempts || []).find((attempt) => attempt.testId === testId) || null;
}

function testsForStudent(student, subject = '') {
  const subjects = studentSubjects(student);
  return getTeacherTests(student.teacherId).filter(
    (test) => subjects.includes(test.subject) && (!subject || test.subject === subject)
  );
}

function pendingTestsForStudent(student, subject = '') {
  return testsForStudent(student, subject).filter(
    (test) => !studentAttemptsForTest(student, test.id)
  );
}

function activeTodayTestsForStudent(student, subject = '') {
  return pendingTestsForStudent(student, subject)
    .filter((test) => isWithinLastHours(test.createdAt, 24))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function backlogTestsForStudent(student, subject = '') {
  return pendingTestsForStudent(student, subject)
    .filter((test) => !isWithinLastHours(test.createdAt, 24))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function backlogCountForStudent(student, subject = '') {
  return backlogTestsForStudent(student, subject).length;
}

function todayTestForStudent(student, subject = '') {
  const candidates = activeTodayTestsForStudent(student, subject);
  return candidates[0] || null;
}

function lastScoreForStudent(student) {
  const scored = (student.attempts || [])
    .filter((attempt) => typeof attempt.scorePercent === 'number')
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

  return scored[0] ? `${scored[0].scorePercent}%` : '-';
}

function averageScoreForStudent(student) {
  const scored = (student.attempts || []).filter(
    (attempt) => typeof attempt.scorePercent === 'number'
  );
  if (!scored.length) return 0;
  const total = scored.reduce((sum, attempt) => sum + attempt.scorePercent, 0);
  return Math.round(total / scored.length);
}

function consistencyForStudent(student) {
  const totalTests = testsForStudent(student).length;
  if (!totalTests) return 0;

  const attemptedCount = pendingTestsForStudent(student).length;
  return Math.round(((totalTests - attemptedCount) / totalTests) * 100);
}

function averageScoreForTeacher(teacherId) {
  const students = getTeacherStudents(teacherId);
  if (!students.length) return 0;

  const studentAverages = students.map(averageScoreForStudent);
  const total = studentAverages.reduce((sum, score) => sum + score, 0);
  return Math.round(total / students.length);
}

function teacherDailyStreak(teacherId) {
  const uniqueDays = new Set(getTeacherTests(teacherId).map((test) => dateOnly(test.createdAt)));
  if (!uniqueDays.size) return 0;

  let streak = 0;
  const cursor = new Date();

  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!uniqueDays.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function generateUniqueStudentUsername(firstName, lastName) {
  const base = `${firstName}${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12) || 'student';

  const taken = new Set(studentRecords().map((student) => student.username));
  let index = 1;
  let candidate = `${base}${index}`;
  while (taken.has(candidate)) {
    index += 1;
    candidate = `${base}${index}`;
  }
  return candidate;
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadCsv(filename, headers, rows) {
  const headerLine = headers.map(csvEscape).join(',');
  const bodyLines = rows.map((row) => row.map(csvEscape).join(','));
  downloadTextFile(filename, [headerLine, ...bodyLines].join('\n'));
}

function escapePdfText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildSimplePdf(lines) {
  const contentLines = lines.map((line, index) => {
    const y = 790 - index * 18;
    return `1 0 0 1 40 ${y} Tm (${escapePdfText(line)}) Tj`;
  });

  const stream = `BT\n/F1 12 Tf\n14 TL\n${contentLines.join('\n')}\nET`;

  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj'
  ];

  const chunks = ['%PDF-1.4\n'];
  const offsets = [0];

  objects.forEach((object) => {
    offsets.push(chunks.join('').length);
    chunks.push(`${object}\n`);
  });

  const xrefStart = chunks.join('').length;
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push('0000000000 65535 f \n');
  for (let index = 1; index <= objects.length; index += 1) {
    chunks.push(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
  }

  chunks.push(`trailer << /Size ${objects.length + 1} /Root 1 0 R >>\n`);
  chunks.push(`startxref\n${xrefStart}\n%%EOF`);

  return new Blob([chunks.join('')], { type: 'application/pdf' });
}

function downloadPdf(filename, lines) {
  const blob = buildSimplePdf(lines);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function startStudentSession(studentId) {
  state.auth.currentStudentId = studentId;
  state.auth.currentRole = 'student';
  runtime.activeStudentSessionStart = Date.now();
  saveState();
}

function closeStudentSession() {
  const student = getCurrentStudent();
  if (!student || !runtime.activeStudentSessionStart) return;

  const elapsed = Math.max(0, Math.floor((Date.now() - runtime.activeStudentSessionStart) / 1000));
  student.usageSeconds = (student.usageSeconds || 0) + elapsed;
  runtime.activeStudentSessionStart = null;
  saveState();
}

function clearTestSession() {
  if (runtime.activeTimerId) {
    clearInterval(runtime.activeTimerId);
    runtime.activeTimerId = null;
  }
  runtime.activeTestSession = null;
}

function bindVisibilityWarnings() {
  if (runtime.visibilityHandlerBound) return;

  document.addEventListener('visibilitychange', () => {
    const session = runtime.activeTestSession;
    if (!session || !document.hidden) return;

    const test = state.tests[session.testId];
    if (!test || test.type !== 'long') return;

    session.tabWarnings += 1;

    const student = state.students[session.studentId];
    const warningMessage = `${student.firstName} ${student.lastName} switched tabs during ${test.title}. Warning ${session.tabWarnings}.`;

    addTeacherAlert(
      test.teacherId,
      student.id,
      test.id,
      warningMessage,
      'tab-switch'
    );

    const warningNode = document.getElementById('tabSwitchWarning');
    if (warningNode) {
      warningNode.textContent = warningMessage;
    }

    saveState();
  });

  runtime.visibilityHandlerBound = true;
}

function logoutToWelcome() {
  closeStudentSession();
  clearTestSession();

  state.auth.currentRole = null;
  state.auth.currentTeacherId = null;
  state.auth.currentStudentId = null;
  saveState();

  renderWelcome();
}

function renderWelcome() {
  clearTestSession();

  app.innerHTML = `
    <section class="welcome-page">
      <div class="hero-overlay"></div>
      <button class="admin-corner-btn" id="adminEntryBtn">Admin Sign In</button>

      <div class="hero-content">
        <header class="hero-header">
          ${brandLogo()}
        </header>

        <h1 class="hero-title">
          Learn Smarter,<br />
          <span>Achieve More</span>
        </h1>

        <p class="hero-tagline">Your all-in-one platform for daily tests, study guides and seamless teacher-student collaboration</p>

        <div class="hero-actions">
          <button class="hero-btn student" id="studentSignIn">I'm a Student</button>
          <button class="hero-btn teacher" id="teacherSignIn">I'm a Teacher</button>
        </div>
      </div>

      <footer class="hero-footer">Developed by LIFT Educations</footer>
    </section>
  `;

  document.getElementById('studentSignIn').addEventListener('click', renderStudentLogin);
  document.getElementById('teacherSignIn').addEventListener('click', renderTeacherLogin);
  document.getElementById('adminEntryBtn').addEventListener('click', renderAdminLogin);
}

function renderAdminLogin() {
  clearTestSession();

  app.innerHTML = `
    <section class="welcome-page">
      <div class="hero-overlay"></div>
      <div class="hero-content">
        <header class="hero-header">
          ${brandLogo()}
        </header>

        <div class="auth-card">
          <h2 class="auth-title">Institution Admin Sign In</h2>
          <p class="auth-subtitle">Use your Institution ID and password to manage teachers and monitor performance.</p>
          <form id="adminLoginForm" class="auth-form">
            <label for="institutionId">Institution ID</label>
            <input id="institutionId" type="text" placeholder="Enter institution ID" required />

            <label for="adminPassword">Password</label>
            <input id="adminPassword" type="password" placeholder="Enter password" required />

            <button type="submit" class="cta-main auth-submit">Sign In as Admin</button>
            <button type="button" class="back-link-btn" id="backBtn">Back</button>
          </form>
          <p class="auth-note" id="adminAuthNote"></p>
        </div>
      </div>

      <footer class="hero-footer">Developed by LIFT Educations</footer>
    </section>
  `;

  document.getElementById('adminLoginForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const institutionId = document.getElementById('institutionId').value.trim();
    const password = document.getElementById('adminPassword').value.trim();

    if (
      institutionId !== state.auth.admin.institutionId ||
      password !== state.auth.admin.password
    ) {
      document.getElementById('adminAuthNote').textContent =
        'Invalid Institution ID or password.';
      return;
    }

    state.auth.currentRole = 'admin';
    saveState();
    renderAdminDashboard(state.feedback.adminSearchQuery || '');
  });

  document.getElementById('backBtn').addEventListener('click', renderWelcome);
}

function renderAdminDashboard(searchQuery = '') {
  clearTestSession();

  const teachers = teacherRecords();
  const students = studentRecords();
  const adminView = state.feedback.adminView || 'overview';
  const adminNotifications = getNotifications('admin').slice(0, 20);
  const adminUnread = unreadNotificationCount('admin');
  const subjects = subjectList();
  const subjectFilter = state.feedback.adminSubjectFilter || 'all';
  const selectedStudent =
    state.students[state.feedback.adminSelectedStudentId] || null;

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const subjectFiltered = students.filter((student) =>
    subjectFilter === 'all' ? true : studentHasSubject(student, subjectFilter)
  );
  const filteredStudents = subjectFiltered.filter((student) => {
    const fullName = `${student.firstName} ${student.lastName}`.toLowerCase();
    return !normalizedQuery || fullName.includes(normalizedQuery);
  });

  const topPerformerBySubject = subjects.map((subject) => {
    const candidates = students
      .filter((student) => studentHasSubject(student, subject))
      .map((student) => ({
        student,
        avg: averageScoreForStudent(student),
        consistency: consistencyForStudent(student)
      }))
      .sort((a, b) => b.avg - a.avg || b.consistency - a.consistency);
    return { subject, top: candidates[0] || null };
  });

  const teacherComplianceRows = teachers.map((teacher) => ({
    teacher,
    testsToday: getTeacherTests(teacher.id).filter((test) => isToday(test.createdAt)).length,
    streak: teacherDailyStreak(teacher.id),
    studentsCount: getTeacherStudents(teacher.id).length
  }));

  const messagesFeed = state.messages
    .map(normalizeMessage)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 30);

  app.innerHTML = `
    <div class="dashboard-shell">
      <header class="main-nav">
        <div class="left-nav">
          ${brandLogo(true)}
          <button class="nav-tab ${adminView === 'overview' ? 'active' : ''}" data-admin-view="overview">Overview</button>
          <button class="nav-tab ${adminView === 'teachers' ? 'active' : ''}" data-admin-view="teachers">Teachers</button>
          <button class="nav-tab ${adminView === 'students' ? 'active' : ''}" data-admin-view="students">Students</button>
          <button class="nav-tab ${adminView === 'messages' ? 'active' : ''}" data-admin-view="messages">Messages</button>
          <button class="nav-tab ${adminView === 'notifications' ? 'active' : ''}" data-admin-view="notifications">
            Notifications
            <span class="notif-badge">${adminUnread}</span>
          </button>
        </div>
        <div class="top-actions">
          <button class="notif-btn" id="adminNotifBtn">
            Notifications
            <span class="notif-badge">${adminUnread}</span>
          </button>
          <button class="signout" id="logoutBtn">Sign Out</button>
        </div>
      </header>

      <main class="page container-xl">
        <h2>Institution Admin Panel</h2>
        <p class="subline">Track teacher productivity, student performance and communication in one place.</p>

        ${adminView === 'overview'
          ? `
          <section class="panel">
            <h3>Institution Credentials</h3>
            <div class="credential-grid">
              <div class="credential-item">
                <small>Institution ID</small>
                <strong>${state.auth.admin.institutionId}</strong>
              </div>
              <div class="credential-item">
                <small>Admin Password</small>
                <strong>${state.auth.admin.password}</strong>
              </div>
            </div>
          </section>

          <section class="panel">
            <h3>Subject Filter and Toppers</h3>
            <label for="adminSubjectFilter">Filter by Subject</label>
            <select id="adminSubjectFilter">
              <option value="all" ${subjectFilter === 'all' ? 'selected' : ''}>All Subjects</option>
              ${subjects.map((subject) => `<option value="${subject}" ${subjectFilter === subject ? 'selected' : ''}>${subject}</option>`).join('')}
            </select>

            <div class="table-wrap" style="margin-top:10px;">
              <table>
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Top Student</th>
                    <th>Avg Score</th>
                    <th>Consistency</th>
                  </tr>
                </thead>
                <tbody>
                  ${topPerformerBySubject.length
                    ? topPerformerBySubject
                        .filter((row) => (subjectFilter === 'all' ? true : row.subject === subjectFilter))
                        .map((row) => row.top
                          ? `<tr>
                              <td>${row.subject}</td>
                              <td>${row.top.student.firstName} ${row.top.student.lastName}</td>
                              <td>${row.top.avg}%</td>
                              <td>${row.top.consistency}%</td>
                            </tr>`
                          : `<tr>
                              <td>${row.subject}</td>
                              <td colspan="3">No student data yet</td>
                            </tr>`)
                        .join('')
                    : '<tr><td colspan="4">No subjects yet.</td></tr>'}
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel table-panel">
            <h3>Teacher Daily Compliance</h3>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Teacher</th>
                    <th>Tests Today</th>
                    <th>Daily Streak</th>
                    <th>Students</th>
                  </tr>
                </thead>
                <tbody>
                  ${teacherComplianceRows.length
                    ? teacherComplianceRows
                        .map((row) => `
                          <tr>
                            <td>${row.teacher.fullName}</td>
                            <td>${row.testsToday}</td>
                            <td>${row.streak}</td>
                            <td>${row.studentsCount}</td>
                          </tr>
                        `)
                        .join('')
                    : '<tr><td colspan="4">No teachers available.</td></tr>'}
                </tbody>
              </table>
            </div>
          </section>
        `
          : ''}

        ${adminView === 'teachers'
          ? `
          <section class="panel">
            <h3>Create Teacher Accounts (Free Trial)</h3>
            <p class="muted">Limit: ${state.trialLimits.teacherAccounts} teachers. Current: ${teachers.length}/${state.trialLimits.teacherAccounts}</p>
            <form id="createTeacherForm">
              <label for="teacherFullName">Teacher Name</label>
              <input id="teacherFullName" type="text" placeholder="e.g. Anjali Nair" required />

              <label for="teacherEmail">Teacher Email</label>
              <input id="teacherEmail" type="email" placeholder="teacher@email.com" required />

              <label for="teacherPhone">Teacher Phone</label>
              <input id="teacherPhone" type="text" placeholder="10-digit phone" required />

              <label for="teacherUsername">Username</label>
              <input id="teacherUsername" type="text" placeholder="e.g. anjali.teacher" required />

              <label for="teacherPassword">Password</label>
              <input id="teacherPassword" type="text" placeholder="Set password" required />

              <button class="cta-main" type="submit">Create Teacher</button>
            </form>
            <p class="auth-note" id="teacherCreateStatus">${state.feedback.adminTeacherStatus}</p>
          </section>

          <section class="panel table-panel">
            <h3>Teacher Accounts</h3>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Username</th>
                    <th>Password</th>
                    <th>Email Share</th>
                    <th>WhatsApp Share</th>
                    <th>Reset</th>
                  </tr>
                </thead>
                <tbody>
                  ${teachers.length
                    ? teachers
                        .map((teacher) => {
                          const emailBody = encodeURIComponent(
                            `Hello ${teacher.fullName}, your teacher login is username: ${teacher.username} and password: ${teacher.password}.`
                          );
                          const emailHref = teacher.email
                            ? `mailto:${teacher.email}?subject=${encodeURIComponent('Teacher Login Credentials')}&body=${emailBody}`
                            : '';
                          const waNumber = phoneToWhatsapp(teacher.phone);
                          const waText = encodeURIComponent(
                            `Hello ${teacher.fullName}, your login credentials are username: ${teacher.username}, password: ${teacher.password}.`
                          );
                          const waHref = waNumber ? `https://wa.me/${waNumber}?text=${waText}` : '';
                          return `
                          <tr>
                            <td>${teacher.fullName}</td>
                            <td>${teacher.email || '-'}</td>
                            <td>${teacher.phone || '-'}</td>
                            <td>${teacher.username}</td>
                            <td>${teacher.password}</td>
                            <td>${emailHref ? `<a href="${emailHref}" target="_blank" rel="noreferrer">Share</a>` : '-'}</td>
                            <td>${waHref ? `<a href="${waHref}" target="_blank" rel="noreferrer">Share</a>` : '-'}</td>
                            <td><button class="mini-btn" data-admin-reset-teacher="${teacher.id}">Set New Password</button></td>
                          </tr>
                        `;
                        })
                        .join('')
                    : '<tr><td colspan="8">No teacher accounts created yet.</td></tr>'}
                </tbody>
              </table>
            </div>
          </section>
        `
          : ''}

        ${adminView === 'students'
          ? `
          <section class="panel table-panel">
            <h3>Student Profiles, Scores and History</h3>
            <label for="adminSubjectFilter">Filter by subject</label>
            <select id="adminSubjectFilter">
              <option value="all" ${subjectFilter === 'all' ? 'selected' : ''}>All Subjects</option>
              ${subjects.map((subject) => `<option value="${subject}" ${subjectFilter === subject ? 'selected' : ''}>${subject}</option>`).join('')}
            </select>

            <label for="adminStudentSearch">Search by student name</label>
            <input id="adminStudentSearch" value="${searchQuery}" placeholder="Type student name..." />

            <div class="table-wrap" style="margin-top:10px;">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Teacher</th>
                    <th>Subjects</th>
                    <th>Avg Score</th>
                    <th>Consistency</th>
                    <th>Usage</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Profile</th>
                    <th>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  ${filteredStudents.length
                    ? filteredStudents
                        .map((student) => {
                          const teacher = getTeacherById(student.teacherId);
                          return `
                            <tr>
                              <td>${student.firstName} ${student.lastName}</td>
                              <td>${teacher ? teacher.fullName : '-'}</td>
                              <td>${studentSubjects(student).join(', ')}</td>
                              <td>${averageScoreForStudent(student)}%</td>
                              <td>${consistencyForStudent(student)}%</td>
                              <td>${Math.round((student.usageSeconds || 0) / 60)} mins</td>
                              <td>${student.phone}</td>
                              <td>${student.email}</td>
                              <td><button class="mini-btn" data-admin-student="${student.id}">View</button></td>
                              <td><button class="mini-btn danger" data-admin-delete-student="${student.id}">Delete</button></td>
                            </tr>
                          `;
                        })
                        .join('')
                    : '<tr><td colspan="10">No matching students found.</td></tr>'}
                </tbody>
              </table>
            </div>
          </section>

          ${selectedStudent
            ? `
              <section class="panel">
                <h3>Student Profile: ${selectedStudent.firstName} ${selectedStudent.lastName}</h3>
                <p class="muted">Subjects: ${studentSubjects(selectedStudent).join(', ')} | Username: ${selectedStudent.username}</p>
                <p class="muted">Phone: ${selectedStudent.phone} | Email: ${selectedStudent.email}</p>
                ${scoreHistoryMarkup(selectedStudent)}

                <label for="adminMessageToStudent">Send Message</label>
                <textarea id="adminMessageToStudent" rows="3" placeholder="Type message for this student..."></textarea>
                <button class="cta-soft" id="adminSendStudentMessageBtn">Send Message</button>
                <p class="auth-note" id="adminStudentMessageStatus"></p>
              </section>
            `
            : ''}
        `
          : ''}

        ${adminView === 'messages'
          ? `
          <section class="panel">
            <h3>Communication Feed</h3>
            <div class="social-feed">
              ${messagesFeed.length
                ? messagesFeed
                    .map((message) => {
                      const normalized = normalizeMessage(message);
                      const senderRole = normalized.fromRole;
                      const senderId = senderRole === 'student'
                        ? normalized.studentId
                        : senderRole === 'teacher'
                          ? normalized.teacherId
                          : 'admin';
                      const senderName = messageSenderLabel(normalized);
                      return `
                      <article class="feed-card ${normalized.fromRole === 'admin' ? 'mine' : ''}">
                        <div class="feed-meta">
                          <div class="feed-user">
                            ${avatarMarkup(senderRole, senderId, senderName)}
                            <strong>${senderName}</strong>
                          </div>
                          <small>${readableDate(normalized.createdAt)}</small>
                        </div>
                        <p>${normalized.text}</p>
                      </article>
                    `;
                    })
                    .join('')
                : '<p class="muted">No messages yet.</p>'}
            </div>

            <label for="adminMessageRecipient">Message Recipient</label>
            <select id="adminMessageRecipient">
              <option value="">Choose recipient</option>
              <optgroup label="Teachers">
                ${teachers
                  .map((record) => `<option value="teacher:${record.id}">${record.fullName}</option>`)
                  .join('')}
              </optgroup>
              <optgroup label="Students">
                ${students
                  .map(
                    (record) =>
                      `<option value="student:${record.id}">${record.firstName} ${record.lastName}</option>`
                  )
                  .join('')}
              </optgroup>
            </select>
            <label for="adminMessageInput">Message</label>
            <textarea id="adminMessageInput" rows="3" placeholder="Type message..."></textarea>
            <button class="cta-soft" id="adminSendMessageBtn">Send Message</button>
            <p class="auth-note" id="adminMessageStatus"></p>
          </section>
        `
          : ''}

        ${adminView === 'notifications'
          ? `
          <section class="panel">
            <h3>Admin Notifications</h3>
            <div class="social-feed">
              ${adminNotifications.length
                ? adminNotifications
                    .map((notification) => `
                      <article class="feed-card">
                        <div class="feed-meta">
                          <strong>${notification.type.replace('-', ' ').toUpperCase()}</strong>
                          <small>${readableDate(notification.createdAt)}</small>
                        </div>
                        <p>${notification.message}</p>
                        ${notification.type === 'teacher-password-reset-request' && notification.teacherId
                          ? `<button class="mini-btn" data-admin-reset-request="${notification.teacherId}">Set New Password</button>`
                          : ''}
                      </article>
                    `)
                    .join('')
                : '<p class="muted">No notifications yet.</p>'}
            </div>
          </section>
        `
          : ''}
      </main>
    </div>
  `;

  document.getElementById('logoutBtn').addEventListener('click', logoutToWelcome);

  document.querySelectorAll('[data-admin-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.feedback.adminView = button.dataset.adminView;
      if (button.dataset.adminView === 'notifications') {
        markNotificationsRead('admin');
      }
      saveState();
      renderAdminDashboard(searchQuery);
    });
  });

  document.getElementById('adminNotifBtn').addEventListener('click', () => {
    state.feedback.adminView = 'notifications';
    markNotificationsRead('admin');
    saveState();
    renderAdminDashboard(searchQuery);
  });

  const subjectFilterNode = document.getElementById('adminSubjectFilter');
  if (subjectFilterNode) {
    subjectFilterNode.addEventListener('change', (event) => {
      state.feedback.adminSubjectFilter = event.target.value;
      saveState();
      renderAdminDashboard(searchQuery);
    });
  }

  const createTeacherForm = document.getElementById('createTeacherForm');
  if (createTeacherForm) {
    createTeacherForm.addEventListener('submit', (event) => {
      event.preventDefault();

      const fullName = sanitizeValue(document.getElementById('teacherFullName').value);
      const email = sanitizeValue(document.getElementById('teacherEmail').value.toLowerCase());
      const phone = sanitizeValue(document.getElementById('teacherPhone').value);
      const username = sanitizeValue(document.getElementById('teacherUsername').value).toLowerCase();
      const password = sanitizeValue(document.getElementById('teacherPassword').value);

      if (!fullName || !email || !phone || !username || !password) {
        state.feedback.adminTeacherStatus = 'Please fill all teacher fields.';
        saveState();
        renderAdminDashboard(searchQuery);
        return;
      }

      if (teachers.length >= state.trialLimits.teacherAccounts) {
        state.feedback.adminTeacherStatus =
          `Trial limit reached. Only ${state.trialLimits.teacherAccounts} teacher accounts are allowed.`;
        saveState();
        renderAdminDashboard(searchQuery);
        return;
      }

      if (getTeacherByUsername(username)) {
        state.feedback.adminTeacherStatus =
          'Teacher username already exists. Choose a different one.';
        saveState();
        renderAdminDashboard(searchQuery);
        return;
      }

      const teacherId = uid('teacher');
      state.auth.teachers.push({
        id: teacherId,
        fullName,
        email,
        phone,
        username,
        password,
        profileImage: '',
        mustChangePassword: false,
        createdAt: nowIso()
      });
      state.teachers[teacherId] = createTeacherWorkspace(fullName);
      state.feedback.adminTeacherStatus = `Teacher created: ${fullName} (${username})`;
      saveState();
      renderAdminDashboard(searchQuery);
    });
  }

  const searchNode = document.getElementById('adminStudentSearch');
  if (searchNode) {
    searchNode.addEventListener('input', (event) => {
      state.feedback.adminSearchQuery = event.target.value;
      saveState();
      renderAdminDashboard(event.target.value);
    });
  }

  document.querySelectorAll('[data-admin-student]').forEach((button) => {
    button.addEventListener('click', () => {
      state.feedback.adminSelectedStudentId = button.dataset.adminStudent;
      saveState();
      renderAdminDashboard(searchQuery);
    });
  });

  document.querySelectorAll('[data-admin-delete-student]').forEach((button) => {
    button.addEventListener('click', () => {
      const studentId = button.dataset.adminDeleteStudent;
      const student = state.students[studentId];
      if (!student) return;

      const confirmed = confirm(
        `Delete ${student.firstName} ${student.lastName}? This will remove profile, score history, messages and alerts.`
      );
      if (!confirmed) return;

      if (deleteStudentRecord(studentId)) {
        saveState();
        renderAdminDashboard(searchQuery);
      }
    });
  });

  document.querySelectorAll('[data-admin-reset-teacher]').forEach((button) => {
    button.addEventListener('click', () => {
      const teacherId = button.dataset.adminResetTeacher;
      const teacher = getTeacherById(teacherId);
      if (!teacher) return;

      const proposed = prompt(
        `Set new password for ${teacher.fullName}:`,
        generateTempPassword()
      );
      if (!proposed) return;

      teacher.password = sanitizeValue(proposed);
      teacher.mustChangePassword = true;
      pushNotification({
        recipientRole: 'teacher',
        recipientId: teacher.id,
        teacherId: teacher.id,
        type: 'password-reset',
        message: `Admin reset your password. Temporary password: ${teacher.password}`
      });
      state.feedback.adminTeacherStatus = `New password set for ${teacher.fullName}.`;
      saveState();
      renderAdminDashboard(searchQuery);
    });
  });

  const sendToStudentButton = document.getElementById('adminSendStudentMessageBtn');
  if (sendToStudentButton && selectedStudent) {
    sendToStudentButton.addEventListener('click', () => {
      const text = sanitizeValue(document.getElementById('adminMessageToStudent').value);
      const status = document.getElementById('adminStudentMessageStatus');
      if (!text) {
        status.textContent = 'Type a message first.';
        return;
      }

      sendMessage({
        fromRole: 'admin',
        fromId: 'admin',
        toRole: 'student',
        toId: selectedStudent.id,
        studentId: selectedStudent.id,
        teacherId: selectedStudent.teacherId,
        text
      });
      pushNotification({
        recipientRole: 'student',
        recipientId: selectedStudent.id,
        studentId: selectedStudent.id,
        teacherId: selectedStudent.teacherId,
        type: 'new-message',
        message: 'New message from Admin.'
      });
      pushNotification({
        recipientRole: 'teacher',
        recipientId: selectedStudent.teacherId,
        studentId: selectedStudent.id,
        teacherId: selectedStudent.teacherId,
        type: 'new-message',
        message: `Admin sent a message to ${selectedStudent.firstName} ${selectedStudent.lastName}.`
      });
      saveState();
      status.textContent = 'Message sent.';
      renderAdminDashboard(searchQuery);
    });
  }

  const adminSendMessageBtn = document.getElementById('adminSendMessageBtn');
  if (adminSendMessageBtn) {
    adminSendMessageBtn.addEventListener('click', () => {
      const recipientValue = document.getElementById('adminMessageRecipient').value;
      const text = sanitizeValue(document.getElementById('adminMessageInput').value);
      const status = document.getElementById('adminMessageStatus');
      if (!recipientValue || !text) {
        status.textContent = 'Choose recipient and type a message.';
        return;
      }

      const [role, id] = recipientValue.split(':');
      if (!role || !id) {
        status.textContent = 'Invalid recipient selection.';
        return;
      }

      if (role === 'teacher') {
        const recipientTeacher = getTeacherById(id);
        if (!recipientTeacher) {
          status.textContent = 'Teacher not found.';
          return;
        }
        sendMessage({
          fromRole: 'admin',
          fromId: 'admin',
          toRole: 'teacher',
          toId: recipientTeacher.id,
          teacherId: recipientTeacher.id,
          studentId: '',
          text
        });
        pushNotification({
          recipientRole: 'teacher',
          recipientId: recipientTeacher.id,
          teacherId: recipientTeacher.id,
          type: 'new-message',
          message: 'New message from Admin.'
        });
      } else if (role === 'student') {
        const recipientStudent = state.students[id];
        if (!recipientStudent) {
          status.textContent = 'Student not found.';
          return;
        }
        sendMessage({
          fromRole: 'admin',
          fromId: 'admin',
          toRole: 'student',
          toId: recipientStudent.id,
          teacherId: recipientStudent.teacherId,
          studentId: recipientStudent.id,
          text
        });
        pushNotification({
          recipientRole: 'student',
          recipientId: recipientStudent.id,
          teacherId: recipientStudent.teacherId,
          studentId: recipientStudent.id,
          type: 'new-message',
          message: 'New message from Admin.'
        });
      } else {
        status.textContent = 'Unsupported recipient role.';
        return;
      }

      saveState();
      status.textContent = 'Message sent.';
      renderAdminDashboard(searchQuery);
    });
  }

  document.querySelectorAll('[data-admin-reset-request]').forEach((button) => {
    button.addEventListener('click', () => {
      const teacherId = button.dataset.adminResetRequest;
      const teacher = getTeacherById(teacherId);
      if (!teacher) return;

      const proposed = prompt(
        `Teacher forgot password request from ${teacher.fullName}. Set new password:`,
        generateTempPassword()
      );
      if (!proposed) return;

      teacher.password = sanitizeValue(proposed);
      teacher.mustChangePassword = true;
      pushNotification({
        recipientRole: 'teacher',
        recipientId: teacher.id,
        teacherId: teacher.id,
        type: 'password-reset',
        message: `Admin set a new password for you: ${teacher.password}`
      });
      state.feedback.adminTeacherStatus =
        `Password reset completed for ${teacher.fullName}.`;
      saveState();
      renderAdminDashboard(searchQuery);
    });
  });
}

function renderStudentLogin() {
  clearTestSession();

  app.innerHTML = `
    <section class="welcome-page">
      <div class="hero-overlay"></div>
      <div class="hero-content">
        <header class="hero-header">
          ${brandLogo()}
        </header>

        <div class="auth-card">
          <h2 class="auth-title">Student Sign In</h2>
          <p class="auth-subtitle">Enter username and password. First-time users should set password using their teacher-shared username.</p>

          <form id="studentLoginForm" class="auth-form">
            <label for="studentUsername">Username</label>
            <input id="studentUsername" type="text" placeholder="Enter username" required />

            <label for="studentPassword">Password</label>
            <input id="studentPassword" type="password" placeholder="Enter password" required />

            <button type="submit" class="cta-main auth-submit">Sign In as Student</button>
            <button type="button" class="set-password-btn" id="showSetPasswordBtn">Set Password (First-Time User)</button>
            <button type="button" class="set-password-btn" id="showForgotPasswordBtn">Forgot Password</button>
            <button type="button" class="back-link-btn" id="backBtn">Back</button>
          </form>

          <form id="forgotPasswordForm" class="auth-form hidden" style="margin-top:10px;">
            <label for="forgotUsername">Student Username</label>
            <input id="forgotUsername" type="text" placeholder="Enter your username" />
            <button type="button" class="cta-soft" id="sendResetRequestBtn">Send Reset Request</button>
          </form>

          <form id="setPasswordForm" class="auth-form hidden" style="margin-top:10px;">
            <label for="setUsername">Username</label>
            <input id="setUsername" type="text" placeholder="Enter shared username" />

            <label for="setPassword">New Password</label>
            <input id="setPassword" type="password" placeholder="Create password" />

            <label for="confirmSetPassword">Confirm Password</label>
            <input id="confirmSetPassword" type="password" placeholder="Confirm password" />

            <button type="button" class="cta-main" id="savePasswordBtn">Save Password</button>
          </form>

          <p class="auth-note" id="studentAuthNote"></p>
        </div>
      </div>

      <footer class="hero-footer">Developed by LIFT Educations</footer>
    </section>
  `;

  document.getElementById('studentLoginForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const username = document.getElementById('studentUsername').value.trim().toLowerCase();
    const password = document.getElementById('studentPassword').value.trim();
    const note = document.getElementById('studentAuthNote');

    const student = getStudentByUsername(username);
    if (!student) {
      note.textContent =
        'Username not found. Ask your teacher to share your username (email/WhatsApp/CSV).';
      return;
    }

    if (!student.password) {
      note.textContent = 'Password is not set yet. Use Set Password first.';
      return;
    }

    if (student.password !== password) {
      note.textContent = 'Invalid student password.';
      return;
    }

    startStudentSession(student.id);
    if (student.mustChangePassword) {
      state.feedback.studentView = 'accounts';
      saveState();
    }
    renderStudentDashboard();
  });

  document.getElementById('showSetPasswordBtn').addEventListener('click', () => {
    document.getElementById('setPasswordForm').classList.toggle('hidden');
  });

  document.getElementById('showForgotPasswordBtn').addEventListener('click', () => {
    document.getElementById('forgotPasswordForm').classList.toggle('hidden');
  });

  document.getElementById('savePasswordBtn').addEventListener('click', () => {
    const username = document.getElementById('setUsername').value.trim().toLowerCase();
    const password = document.getElementById('setPassword').value.trim();
    const confirm = document.getElementById('confirmSetPassword').value.trim();
    const note = document.getElementById('studentAuthNote');

    const student = getStudentByUsername(username);
    if (!student) {
      note.textContent = 'Username not found. Check the shared CSV/email from your teacher.';
      return;
    }

    if (!password || password.length < 6) {
      note.textContent = 'Password should be at least 6 characters.';
      return;
    }

    if (password !== confirm) {
      note.textContent = 'Passwords do not match.';
      return;
    }

    student.password = password;
    student.passwordSetAt = nowIso();
    student.mustChangePassword = false;
    saveState();

    note.textContent = 'Password set successfully. You can now sign in.';
  });

  document.getElementById('sendResetRequestBtn').addEventListener('click', () => {
    const username = sanitizeValue(
      document.getElementById('forgotUsername').value.toLowerCase()
    );
    const note = document.getElementById('studentAuthNote');
    if (!username) {
      note.textContent = 'Enter your username first.';
      return;
    }

    const student = getStudentByUsername(username);
    if (!student) {
      note.textContent = 'Username not found.';
      return;
    }

    const teacher = getTeacherById(student.teacherId);
    pushNotification({
      recipientRole: 'teacher',
      recipientId: student.teacherId,
      studentId: student.id,
      teacherId: student.teacherId,
      type: 'student-password-reset-request',
      message: `Password reset request from student ${student.firstName} ${student.lastName}.`
    });
    saveState();
    note.textContent = `Reset request sent to ${teacher ? teacher.fullName : 'teacher'}.`;
  });

  document.getElementById('backBtn').addEventListener('click', renderWelcome);
}

function renderTeacherLogin() {
  clearTestSession();

  app.innerHTML = `
    <section class="welcome-page">
      <div class="hero-overlay"></div>
      <div class="hero-content">
        <header class="hero-header">
          ${brandLogo()}
        </header>

        <div class="auth-card">
          <h2 class="auth-title">Teacher Sign In</h2>
          <p class="auth-subtitle">Enter username and password created by the institution admin.</p>
          <form id="teacherLoginForm" class="auth-form">
            <label for="teacherUsername">Username</label>
            <input id="teacherUsername" type="text" placeholder="Enter username" required />

            <label for="teacherPassword">Password</label>
            <input id="teacherPassword" type="password" placeholder="Enter password" required />

            <button type="submit" class="cta-main auth-submit">Sign In as Teacher</button>
            <button type="button" class="set-password-btn" id="showTeacherForgotBtn">Forgot Password</button>
            <button type="button" class="back-link-btn" id="backBtn">Back</button>
          </form>
          <form id="teacherForgotForm" class="auth-form hidden" style="margin-top:10px;">
            <label for="teacherForgotUsername">Teacher Username</label>
            <input id="teacherForgotUsername" type="text" placeholder="Enter your teacher username" />
            <button type="button" class="cta-soft" id="sendTeacherResetRequestBtn">Send Reset Request</button>
          </form>
          <p class="auth-note" id="teacherAuthNote"></p>
        </div>
      </div>

      <footer class="hero-footer">Developed by LIFT Educations</footer>
    </section>
  `;

  document.getElementById('teacherLoginForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const username = document.getElementById('teacherUsername').value.trim().toLowerCase();
    const password = document.getElementById('teacherPassword').value.trim();
    const note = document.getElementById('teacherAuthNote');

    if (!state.auth.teachers.length) {
      note.textContent = 'No teacher accounts yet. Ask admin to create teacher access first.';
      return;
    }

    const teacher = getTeacherByUsername(username);
    if (!teacher || teacher.password !== password) {
      note.textContent = 'Invalid teacher username or password.';
      return;
    }

    state.auth.currentRole = 'teacher';
    state.auth.currentTeacherId = teacher.id;
    saveState();
    if (teacher.mustChangePassword) {
      state.feedback.teacherView = 'accounts';
      saveState();
    }
    renderTeacherDashboard();
  });

  document.getElementById('showTeacherForgotBtn').addEventListener('click', () => {
    document.getElementById('teacherForgotForm').classList.toggle('hidden');
  });

  document.getElementById('sendTeacherResetRequestBtn').addEventListener('click', () => {
    const username = sanitizeValue(
      document.getElementById('teacherForgotUsername').value.toLowerCase()
    );
    const note = document.getElementById('teacherAuthNote');
    if (!username) {
      note.textContent = 'Enter your teacher username.';
      return;
    }

    const teacher = getTeacherByUsername(username);
    if (!teacher) {
      note.textContent = 'Teacher username not found.';
      return;
    }

    pushNotification({
      recipientRole: 'admin',
      teacherId: teacher.id,
      type: 'teacher-password-reset-request',
      message: `Password reset request from teacher ${teacher.fullName} (${teacher.username}).`
    });
    saveState();
    note.textContent =
      'Reset request sent to admin. Admin will share new password by Email/WhatsApp.';
  });

  document.getElementById('backBtn').addEventListener('click', renderWelcome);
}

function renderStudentDashboard() {
  const student = getCurrentStudent();
  if (!student) {
    renderStudentLogin();
    return;
  }

  if (!Array.isArray(student.subjects) || !student.subjects.length) {
    student.subjects = student.subject ? [student.subject] : [];
  }
  student.videoNotes =
    student.videoNotes && typeof student.videoNotes === 'object'
      ? student.videoNotes
      : {};

  const teacher = getTeacherById(student.teacherId);
  const workspace = getTeacherWorkspace(student.teacherId);
  const subjects = studentSubjects(student);
  const storedActiveSubject = state.feedback.studentActiveSubject || '';
  const activeSubject = subjects.includes(storedActiveSubject)
    ? storedActiveSubject
    : subjects[0] || '';
  state.feedback.studentActiveSubject = activeSubject;

  const availableTeachers = teacherRecords().filter((record) => {
    const recordWorkspace = getTeacherWorkspace(record.id);
    if (record.id === student.teacherId) return true;
    return subjects.some((subject) => recordWorkspace.subjects.includes(subject));
  });
  if (!availableTeachers.length && teacher) {
    availableTeachers.push(teacher);
  }
  const storedTeacherId = state.feedback.studentSelectedTeacherId || '';
  const selectedTeacherId = availableTeachers.some((record) => record.id === storedTeacherId)
    ? storedTeacherId
    : availableTeachers.find((record) => record.id === student.teacherId)?.id ||
      availableTeachers[0]?.id ||
      student.teacherId;
  state.feedback.studentSelectedTeacherId = selectedTeacherId;
  const selectedTeacher =
    getTeacherById(selectedTeacherId) || teacher || availableTeachers[0] || null;

  const subjectOwnerTeacher =
    availableTeachers.find((record) => {
      const recordWorkspace = getTeacherWorkspace(record.id);
      return activeSubject && recordWorkspace.subjects.includes(activeSubject);
    }) || teacher || selectedTeacher;
  const subjectWorkspace = subjectOwnerTeacher
    ? getTeacherWorkspace(subjectOwnerTeacher.id)
    : workspace;

  const studentView = state.feedback.studentView || 'overview';
  const todayTest = todayTestForStudent(student, activeSubject);
  const pendingTests = backlogTestsForStudent(student, activeSubject).slice(0, 8);
  const backlogCount = pendingTests.length;
  const chatFeed = selectedTeacherId
    ? getConversationMessages(student.id, selectedTeacherId)
    : [];
  const studentNotifications = getNotifications('student', student.id).slice(0, 20);
  const notificationCount = unreadNotificationCount('student', student.id);
  const attempts = attemptsForStudent(student);
  const studentName = `${student.firstName} ${student.lastName}`;
  const selectedTeacherName = selectedTeacher ? selectedTeacher.fullName : 'Teacher';
  const subjectTeacherName = subjectOwnerTeacher ? subjectOwnerTeacher.fullName : selectedTeacherName;
  const resourceSearch = state.feedback.studentResourceSearch || '';
  const subjectResources = (subjectWorkspace?.resourceLibrary || []).filter((resource) =>
    activeSubject ? resource.subject === activeSubject : true
  );
  const filteredResources = rankResourcesByQuery(subjectResources, resourceSearch);
  const pdfResources = filteredResources.filter((resource) => resource.resourceType === 'pdf');
  const ebookResources = filteredResources.filter(
    (resource) => resource.resourceType === 'ebook' || resource.resourceType === 'link'
  );
  const videoResources = filteredResources.filter((resource) => resource.resourceType === 'video');
  const MAX_VISIBLE_RESOURCES = resourceSearch ? 120 : 32;
  const visiblePdfResources = pdfResources.slice(0, MAX_VISIBLE_RESOURCES);
  const visibleEbookResources = ebookResources.slice(0, MAX_VISIBLE_RESOURCES);
  const visibleVideoResources = videoResources.slice(0, MAX_VISIBLE_RESOURCES);
  const videoCards = visibleVideoResources
    .map((resource, index) => ({
      resource,
      title: `Lesson Video ${index + 1}`,
      embedUrl: youtubeEmbedUrl(resource.resourceValue),
      thumbnail: youtubeThumbnailUrl(resource.resourceValue)
    }))
    .filter((item) => item.embedUrl);
  const storedVideoId = state.feedback.studentActiveVideoId || '';
  const activeVideoCard = videoCards.find((item) => item.resource.id === storedVideoId) || videoCards[0] || null;
  state.feedback.studentActiveVideoId = activeVideoCard ? activeVideoCard.resource.id : '';
  const activeVideoNotes = activeVideoCard
    ? student.videoNotes[activeVideoCard.resource.id] || ''
    : '';
  const syllabusAsset = activeSubject
    ? subjectWorkspace?.subjectSyllabi?.[activeSubject] || null
    : null;

  app.innerHTML = `
    <div class="dashboard-shell">
      <header class="main-nav">
        <div class="left-nav">
          ${brandLogo(true)}
          <button class="nav-tab ${studentView === 'overview' ? 'active' : ''}" data-student-view="overview">Dashboard</button>
          <button class="nav-tab ${studentView === 'syllabus' ? 'active' : ''}" data-student-view="syllabus">Syllabus</button>
          <button class="nav-tab ${studentView === 'resources' ? 'active' : ''}" data-student-view="resources">Resources</button>
          <button class="nav-tab ${studentView === 'history' ? 'active' : ''}" data-student-view="history">Test History</button>
          <button class="nav-tab ${studentView === 'messages' ? 'active' : ''}" data-student-view="messages">Messages</button>
          <button class="nav-tab ${studentView === 'notifications' ? 'active' : ''}" data-student-view="notifications">
            Notifications
            <span class="notif-badge">${notificationCount}</span>
          </button>
          <button class="nav-tab ${studentView === 'accounts' ? 'active' : ''}" data-student-view="accounts">Accounts</button>
        </div>
        <div class="top-actions">
          ${subjects.length > 1
            ? `
            <select id="studentSubjectSwitcher" class="nav-subject-select">
              ${subjects
                .map(
                  (subject) =>
                    `<option value="${subject}" ${activeSubject === subject ? 'selected' : ''}>${subject}</option>`
                )
                .join('')}
            </select>
          `
            : ''}
          <button class="notif-btn" id="studentNotifBtn">
            Notifications
            <span class="notif-badge">${notificationCount}</span>
          </button>
          <button class="signout" id="logoutBtn">Sign Out</button>
        </div>
      </header>

      <main class="page container-xl">
        <h2>Welcome, ${student.firstName}</h2>
        <p class="subline">Subject: ${activeSubject || '-'} | Teacher: ${subjectTeacherName}</p>

        ${student.mustChangePassword
          ? `
            <section class="alert-card">
              <div>
                <h3>Password Update Required</h3>
                <p>You are using a temporary password. Open Accounts and set a new password.</p>
              </div>
              <span class="alert-tag">Account</span>
            </section>
          `
          : ''}

        ${studentView === 'overview'
          ? `
          <section class="two-grid">
            <article class="panel">
              <h3>Today's Test</h3>
              ${todayTest
                ? `<p class="headline">${todayTest.title}</p>
                   <p class="muted">${todayTest.type.toUpperCase()} | Duration: ${todayTest.durationMinutes} mins | Subject: ${todayTest.subject}</p>
                   <p class="muted">Available for 24 hours from upload time.</p>
                   <button class="cta-main" id="startTodayTestBtn">Start Test</button>`
                : '<p class="muted">No new test for today.</p>'}
            </article>

            <article class="panel">
              <h3>Pending Tests</h3>
              <div class="stack">
                ${pendingTests.length
                  ? pendingTests
                      .map(
                        (test) => `
                        <div class="stack-item pending-item">
                          <div>
                            <p><strong>${test.title}</strong></p>
                            <p class="muted">${test.type.toUpperCase()} | ${test.durationMinutes} mins | ${readableDate(test.createdAt)}</p>
                          </div>
                          <button class="mini-btn" data-start-pending-test="${test.id}">Start</button>
                        </div>
                      `
                      )
                      .join('')
                  : '<p class="muted">No pending tests.</p>'}
              </div>
              <p class="auth-note">${backlogCount} tests are currently pending.</p>
            </article>
          </section>
        `
          : ''}

        ${studentView === 'syllabus'
          ? `
          <section class="panel">
            <h3>${activeSubject || 'Subject'} Syllabus</h3>
            ${syllabusAsset?.dataUrl
              ? `
              <p class="muted">Uploaded: ${readableDate(syllabusAsset.createdAt || nowIso())}</p>
              <iframe class="pdf-viewer" src="${syllabusAsset.dataUrl}#toolbar=1&navpanes=0"></iframe>
              <a class="mini-btn inline-link-btn" href="${syllabusAsset.dataUrl}" download="${syllabusAsset.name || `${activeSubject}-syllabus.pdf`}">Download Syllabus PDF</a>
            `
              : '<p class="muted">Syllabus has not been uploaded for this subject yet.</p>'}
          </section>
        `
          : ''}

        ${studentView === 'resources'
          ? `
          <section class="panel">
            <h3>Resources: ${activeSubject || '-'}</h3>
            <label for="studentResourceSearch">Search Resources</label>
            <input id="studentResourceSearch" value="${resourceSearch}" placeholder="Search PDFs, eBooks and videos..." />

            <div class="resource-section">
              <h4>PDFs</h4>
              ${pdfResources.length
                ? `
                <div class="resource-grid">
                  ${visiblePdfResources
                    .map(
                      (resource) => `
                    <article class="resource-card modern">
                      <div class="resource-thumb pdf">
                        <span>PDF</span>
                      </div>
                      <div class="resource-body">
                        <p><strong>${resource.resourceValue}</strong></p>
                        ${resource.resourceDataUrl
                          ? `<a href="${resource.resourceDataUrl}" target="_blank" rel="noreferrer">Open PDF</a>`
                          : `<p class="muted">Reference only</p>`}
                      </div>
                    </article>
                  `
                    )
                    .join('')}
                </div>
                ${pdfResources.length > visiblePdfResources.length
                  ? `<p class="muted">Showing ${visiblePdfResources.length} of ${pdfResources.length} PDF resources. Refine search for faster browsing.</p>`
                  : ''}
              `
                : '<p class="muted">No PDF resources found.</p>'}
            </div>

            <div class="resource-section">
              <h4>EBooks</h4>
              ${ebookResources.length
                ? `
                <div class="resource-grid">
                  ${visibleEbookResources
                    .map(
                      (resource) => `
                    <article class="resource-card modern">
                      <div class="resource-thumb ebook">
                        <span>EBOOK</span>
                      </div>
                      <div class="resource-body">
                        <p><strong>${resource.resourceValue}</strong></p>
                        ${resource.resourceSource === 'text'
                          ? `<a href="${resource.resourceValue}" target="_blank" rel="noreferrer">Open eBook</a>`
                          : resource.resourceDataUrl
                            ? `<a href="${resource.resourceDataUrl}" target="_blank" rel="noreferrer">Open eBook File</a>`
                            : '<p class="muted">File reference only</p>'}
                      </div>
                    </article>
                  `
                    )
                    .join('')}
                </div>
                ${ebookResources.length > visibleEbookResources.length
                  ? `<p class="muted">Showing ${visibleEbookResources.length} of ${ebookResources.length} eBook resources. Refine search for faster browsing.</p>`
                  : ''}
              `
                : '<p class="muted">No eBook resources found.</p>'}
            </div>

            <div class="resource-section">
              <h4>Videos</h4>
              ${videoCards.length
                ? `
                <div class="video-learning-shell">
                  <div class="video-stage">
                    <div class="video-stage-head">
                      <p class="muted">Focused Lesson Player</p>
                      <strong>${activeVideoCard ? activeVideoCard.title : '-'}</strong>
                    </div>
                    ${activeVideoCard
                      ? `
                        <div class="video-frame-wrap">
                          <iframe id="lessonVideoFrame" class="video-viewer dedicated" src="${activeVideoCard.embedUrl}" title="Lesson video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
                          <span class="video-brand-mask" aria-hidden="true"></span>
                        </div>
                        <div class="video-controls">
                          <button class="mini-btn" id="playLessonBtn">Play</button>
                          <button class="mini-btn" id="pauseLessonBtn">Pause</button>
                          <button class="mini-btn" id="restartLessonBtn">Restart</button>
                        </div>
                      `
                      : '<p class="muted">Choose a video to play.</p>'}
                  </div>

                  <aside class="video-notes-panel">
                    <h5>Notebook</h5>
                    <p class="muted">Take notes while watching and save them for later.</p>
                    <textarea id="videoNotesInput" rows="10" placeholder="Write your notes here...">${activeVideoNotes}</textarea>
                    <div class="inline-btn-row">
                      <button class="cta-soft" id="saveVideoNotesBtn">Save Notes</button>
                      <button class="cta-soft" id="downloadVideoNotesBtn">Download Notes</button>
                    </div>
                    <p class="auth-note" id="videoNotesStatus"></p>
                  </aside>
                </div>
                <div class="resource-grid">
                  ${videoCards
                    .map(
                      (item) => `
                    <article class="resource-card modern video ${activeVideoCard && activeVideoCard.resource.id === item.resource.id ? 'active' : ''}">
                      <button class="video-card-btn" data-student-video="${item.resource.id}">
                        <div class="resource-thumb video">
                          ${item.thumbnail
                            ? `<img src="${item.thumbnail}" alt="Video thumbnail" />`
                            : '<span>VIDEO</span>'}
                        </div>
                        <div class="resource-body">
                          <p><strong>${item.title}</strong></p>
                          <span class="video-cta">Watch in Player</span>
                        </div>
                      </button>
                    </article>
                  `
                    )
                    .join('')}
                </div>
                ${videoResources.length > visibleVideoResources.length
                  ? `<p class="muted">Showing ${visibleVideoResources.length} of ${videoResources.length} video resources. Refine search for faster browsing.</p>`
                  : ''}
              `
                : '<p class="muted">No videos found.</p>'}
            </div>
          </section>
        `
          : ''}

        ${studentView === 'history'
          ? `
          <section class="panel table-panel">
            <h3>Test History</h3>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Submitted</th>
                    <th>Test</th>
                    <th>Type</th>
                    <th>Score</th>
                    <th>Time Spent</th>
                    <th>Answer Key</th>
                  </tr>
                </thead>
                <tbody>
                  ${attempts.length
                    ? attempts
                        .map((attempt) => {
                          const test = state.tests[attempt.testId];
                          return `
                            <tr>
                              <td>${readableDate(attempt.submittedAt)}</td>
                              <td>${test ? test.title : 'Deleted Test'}</td>
                              <td>${attempt.type.toUpperCase()}</td>
                              <td>${attempt.scorePercent == null ? '-' : `${attempt.scorePercent}%`}</td>
                              <td>${Math.round((attempt.timeSpentSeconds || 0) / 60)} mins</td>
                              <td>${attempt.type === 'mcq' ? `<button class="mini-btn" data-history-answer-key="${attempt.id}">Download</button>` : '-'}</td>
                            </tr>
                          `;
                        })
                        .join('')
                    : '<tr><td colspan="6">No test attempts yet.</td></tr>'}
                </tbody>
              </table>
            </div>
          </section>
        `
          : ''}

        ${studentView === 'messages'
          ? `
          <section class="panel">
            <h3>Teacher Communication</h3>

            <label for="studentTeacherSelect">Select Teacher</label>
            <select id="studentTeacherSelect">
              ${availableTeachers.length
                ? availableTeachers
                    .map(
                      (record) =>
                        `<option value="${record.id}" ${record.id === selectedTeacherId ? 'selected' : ''}>${record.fullName}</option>`
                    )
                    .join('')
                : '<option value="">No teacher available</option>'}
            </select>

            <div class="social-feed">
              ${chatFeed.length
                ? chatFeed
                    .map((message) => {
                      const mine = message.fromRole === 'student';
                      const senderRole = mine
                        ? 'student'
                        : message.fromRole === 'teacher'
                          ? 'teacher'
                          : 'admin';
                      const senderName = mine
                        ? studentName
                        : message.fromRole === 'teacher'
                          ? selectedTeacherName
                          : 'Admin';
                      const senderId = mine
                        ? student.id
                        : message.fromRole === 'teacher'
                          ? selectedTeacherId
                          : 'admin';
                      const avatar = avatarMarkup(senderRole, senderId, senderName);
                      return `
                        <article class="feed-card ${mine ? 'mine' : ''}">
                          <div class="feed-meta">
                            <div class="feed-user">
                              ${avatar}
                              <strong>${senderName}</strong>
                            </div>
                            <small>${readableDate(message.createdAt)}</small>
                          </div>
                          <p>${message.text}</p>
                        </article>
                      `;
                    })
                    .join('')
                : '<p class="muted">No messages yet. Start the conversation.</p>'}
            </div>

            <label for="studentMessageInput">Send message</label>
            <textarea id="studentMessageInput" rows="3" placeholder="Type your message..."></textarea>
            <button class="cta-soft action-btn" id="sendStudentMessageBtn">Send Message</button>
            <p class="auth-note" id="studentActionStatus"></p>
          </section>
        `
          : ''}

        ${studentView === 'notifications'
          ? `
          <section class="panel">
            <h3>Notifications</h3>
            <div class="social-feed">
              ${studentNotifications.length
                ? studentNotifications
                    .map(
                      (notification) => `
                      <article class="feed-card">
                        <div class="feed-meta">
                          <strong>${notification.type.replace('-', ' ').toUpperCase()}</strong>
                          <small>${readableDate(notification.createdAt)}</small>
                        </div>
                        <p>${notification.message}</p>
                      </article>
                    `
                    )
                    .join('')
                : '<p class="muted">No notifications yet.</p>'}
            </div>
          </section>
        `
          : ''}

        ${studentView === 'accounts'
          ? `
          <section class="panel">
            <h3>Account Settings</h3>
            <div class="account-card">
              ${avatarMarkup('student', student.id, studentName)}
              <div>
                <strong>${studentName}</strong>
                <p class="muted">${student.email}</p>
              </div>
            </div>

            <label for="studentProfileUpload">Upload Profile Picture</label>
            <input id="studentProfileUpload" type="file" accept="image/*" />

            <label for="studentNewPassword">New Password</label>
            <input id="studentNewPassword" type="password" placeholder="Enter new password" />

            <label for="studentConfirmPassword">Confirm New Password</label>
            <input id="studentConfirmPassword" type="password" placeholder="Confirm new password" />

            <button class="cta-main" id="saveStudentAccountBtn">Save Account Changes</button>
            <p class="auth-note" id="studentAccountStatus"></p>
          </section>
        `
          : ''}
      </main>
    </div>
  `;

  document.getElementById('logoutBtn').addEventListener('click', logoutToWelcome);
  document.querySelectorAll('[data-student-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.feedback.studentView = button.dataset.studentView;
      if (button.dataset.studentView === 'notifications') {
        markNotificationsRead('student', student.id);
      }
      saveState();
      renderStudentDashboard();
    });
  });

  document.getElementById('studentNotifBtn').addEventListener('click', () => {
    state.feedback.studentView = 'notifications';
    markNotificationsRead('student', student.id);
    saveState();
    renderStudentDashboard();
  });

  const studentSubjectSwitcher = document.getElementById('studentSubjectSwitcher');
  if (studentSubjectSwitcher) {
    studentSubjectSwitcher.addEventListener('change', (event) => {
      state.feedback.studentActiveSubject = event.target.value;
      state.feedback.studentActiveVideoId = '';
      saveState();
      renderStudentDashboard();
    });
  }

  const studentTeacherSelect = document.getElementById('studentTeacherSelect');
  if (studentTeacherSelect) {
    studentTeacherSelect.addEventListener('change', (event) => {
      state.feedback.studentSelectedTeacherId = event.target.value;
      saveState();
      renderStudentDashboard();
    });
  }

  if (todayTest) {
    document.getElementById('startTodayTestBtn').addEventListener('click', () => {
      startTestAttempt(todayTest.id);
    });
  }

  document.querySelectorAll('[data-start-pending-test]').forEach((button) => {
    button.addEventListener('click', () => {
      startTestAttempt(button.dataset.startPendingTest);
    });
  });

  const sendStudentMessageBtn = document.getElementById('sendStudentMessageBtn');
  if (sendStudentMessageBtn) {
    sendStudentMessageBtn.addEventListener('click', () => {
      const text = sanitizeValue(document.getElementById('studentMessageInput').value);
      const status = document.getElementById('studentActionStatus');
      if (!selectedTeacherId) {
        status.textContent = 'No teacher available to receive this message.';
        return;
      }
      if (!text) {
        status.textContent = 'Type a message before sending.';
        return;
      }

      const sent = sendMessage({
        fromRole: 'student',
        fromId: student.id,
        toRole: 'teacher',
        toId: selectedTeacherId,
        studentId: student.id,
        teacherId: selectedTeacherId,
        text
      });
      if (!sent) {
        status.textContent = 'Type a message before sending.';
        return;
      }

      pushNotification({
        recipientRole: 'teacher',
        recipientId: selectedTeacherId,
        teacherId: selectedTeacherId,
        studentId: student.id,
        type: 'new-message',
        message: `New message from ${student.firstName} ${student.lastName}.`
      });
      pushNotification({
        recipientRole: 'admin',
        type: 'new-message',
        teacherId: selectedTeacherId,
        studentId: student.id,
        message: `Student ${student.firstName} ${student.lastName} sent a message to ${selectedTeacherName}.`
      });
      saveState();

      document.getElementById('studentMessageInput').value = '';
      status.textContent = 'Message sent to your teacher.';
      renderStudentDashboard();
    });
  }

  const studentResourceSearchNode = document.getElementById('studentResourceSearch');
  if (studentResourceSearchNode) {
    studentResourceSearchNode.addEventListener('input', (event) => {
      if (runtime.resourceSearchDebounceId) {
        clearTimeout(runtime.resourceSearchDebounceId);
      }
      const nextValue = event.target.value;
      runtime.resourceSearchDebounceId = setTimeout(() => {
        state.feedback.studentResourceSearch = nextValue;
        state.feedback.studentActiveVideoId = '';
        saveState();
        renderStudentDashboard();
      }, 180);
    });
  }

  document.querySelectorAll('[data-student-video]').forEach((button) => {
    button.addEventListener('click', () => {
      state.feedback.studentActiveVideoId = button.dataset.studentVideo;
      saveState();
      renderStudentDashboard();
    });
  });

  const sendLessonCommand = (funcName, args = []) => {
    const frame = document.getElementById('lessonVideoFrame');
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage(
      JSON.stringify({
        event: 'command',
        func: funcName,
        args
      }),
      '*'
    );
  };

  const playLessonBtn = document.getElementById('playLessonBtn');
  if (playLessonBtn) {
    playLessonBtn.addEventListener('click', () => sendLessonCommand('playVideo'));
  }

  const pauseLessonBtn = document.getElementById('pauseLessonBtn');
  if (pauseLessonBtn) {
    pauseLessonBtn.addEventListener('click', () => sendLessonCommand('pauseVideo'));
  }

  const restartLessonBtn = document.getElementById('restartLessonBtn');
  if (restartLessonBtn) {
    restartLessonBtn.addEventListener('click', () => {
      sendLessonCommand('seekTo', [0, true]);
      setTimeout(() => sendLessonCommand('playVideo'), 80);
    });
  }

  const saveVideoNotesBtn = document.getElementById('saveVideoNotesBtn');
  if (saveVideoNotesBtn) {
    saveVideoNotesBtn.addEventListener('click', () => {
      const status = document.getElementById('videoNotesStatus');
      if (!activeVideoCard) {
        status.textContent = 'Select a video first.';
        return;
      }

      const noteText = document.getElementById('videoNotesInput').value;
      student.videoNotes[activeVideoCard.resource.id] = noteText;
      saveState();
      status.textContent = 'Notes saved to your account.';
    });
  }

  const downloadVideoNotesBtn = document.getElementById('downloadVideoNotesBtn');
  if (downloadVideoNotesBtn) {
    downloadVideoNotesBtn.addEventListener('click', () => {
      const status = document.getElementById('videoNotesStatus');
      if (!activeVideoCard) {
        status.textContent = 'Select a video first.';
        return;
      }
      const noteText = document.getElementById('videoNotesInput').value.trim();
      if (!noteText) {
        status.textContent = 'Write notes before downloading.';
        return;
      }

      const lines = [
        `Student: ${studentName}`,
        `Subject: ${activeSubject || '-'}`,
        `Video: ${activeVideoCard.title}`,
        `Saved: ${readableDate(nowIso())}`,
        '',
        noteText
      ];
      downloadTextFile(
        `notes-${student.username}-${activeVideoCard.resource.id}.txt`,
        lines.join('\n')
      );
      status.textContent = 'Notes downloaded.';
    });
  }

  document.querySelectorAll('[data-history-answer-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const attemptId = button.dataset.historyAnswerKey;
      const attempt = attempts.find((item) => item.id === attemptId);
      if (!attempt || attempt.type !== 'mcq') return;
      const test = state.tests[attempt.testId];
      if (!test || !Array.isArray(test.questions)) return;

      const lines = [
        `Answer Key - ${test.title}`,
        `Subject: ${test.subject}`,
        `Downloaded: ${readableDate(nowIso())}`,
        '',
        ...test.questions.map((question, index) => {
          const correct = question.options[question.correctIndex] || 'N/A';
          return `${index + 1}. ${question.text} | Correct: ${correct}`;
        })
      ];
      downloadPdf(
        `${test.title.toLowerCase().replace(/\s+/g, '-')}-answer-key.pdf`,
        lines
      );
    });
  });

  const saveStudentAccountBtn = document.getElementById('saveStudentAccountBtn');
  if (saveStudentAccountBtn) {
    saveStudentAccountBtn.addEventListener('click', async () => {
      const newPassword = document.getElementById('studentNewPassword').value.trim();
      const confirmPassword = document.getElementById('studentConfirmPassword').value.trim();
      const profileFile = document.getElementById('studentProfileUpload').files[0] || null;
      const status = document.getElementById('studentAccountStatus');

      if (newPassword || confirmPassword) {
        if (newPassword.length < 6) {
          status.textContent = 'Password must be at least 6 characters.';
          return;
        }
        if (newPassword !== confirmPassword) {
          status.textContent = 'Passwords do not match.';
          return;
        }
        student.password = newPassword;
        student.mustChangePassword = false;
      }

      if (profileFile) {
        student.profileImage = await fileToDataUrl(profileFile);
      }

      saveState();
      status.textContent = 'Account updated successfully.';
      renderStudentDashboard();
    });
  }
}

function chapterTitleFromPdfName(filename) {
  return sanitizeValue(
    String(filename || 'Chapter')
      .replace(/\.pdf$/i, '')
      .replace(/[_-]+/g, ' ')
  );
}

async function extractTermsFromPdf(file) {
  const text = await extractPdfText(file);
  const keywordTerms = extractKeywordsFromText(text, MCQ_QUESTION_LIMIT);
  if (keywordTerms.length) {
    return keywordTerms;
  }

  // Fallback when text extraction fails for scanned PDFs.
  try {
    const buffer = await file.arrayBuffer();
    const raw = new TextDecoder('latin1').decode(buffer);
    const words = raw.match(/[A-Za-z]{5,}/g) || [];
    const stopWords = new Set([
      'stream', 'endstream', 'obj', 'type', 'pages', 'catalog', 'length',
      'encoding', 'filter', 'xref', 'trailer', 'startxref', 'media', 'font'
    ]);
    const unique = [];

    words.forEach((word) => {
      const normalized = word.toLowerCase();
      if (stopWords.has(normalized)) return;
      if (unique.includes(normalized)) return;
      unique.push(normalized);
    });

    return unique.slice(0, MCQ_QUESTION_LIMIT);
  } catch (error) {
    return [];
  }
}

async function extractPdfText(file, maxPages = 15) {
  if (typeof window !== 'undefined' && window.pdfjsLib) {
    try {
      const buffer = await file.arrayBuffer();
      const loadingTask = window.pdfjsLib.getDocument({ data: buffer });
      const pdf = await loadingTask.promise;
      const pages = Math.min(pdf.numPages, maxPages);
      const chunks = [];

      for (let pageNo = 1; pageNo <= pages; pageNo += 1) {
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        const pageText = content.items.map((item) => item.str).join(' ');
        chunks.push(pageText);
      }
      return chunks.join(' ');
    } catch (error) {
      return '';
    }
  }
  return '';
}

function buildGeneratedMcqQuestions(chapterTitle, subject, terms = []) {
  const cleanTitle = chapterTitle || 'the uploaded chapter';
  const cleanSubject = subject || 'this subject';
  const termBank = terms.length
    ? terms
    : Array.from({ length: MCQ_QUESTION_LIMIT }, (_, index) => `topic ${index + 1}`);
  const stems = [
    `Which keyword is explicitly covered in chapter "${cleanTitle}" for ${cleanSubject}?`,
    `Choose the term that belongs to "${cleanTitle}" (${cleanSubject}).`,
    `Which option best matches the chapter keywords in "${cleanTitle}"?`,
    `Identify the concept extracted from "${cleanTitle}".`,
    `Select the keyword that appears in the uploaded chapter content.`
  ];

  return Array.from({ length: MCQ_QUESTION_LIMIT }, (_, index) => {
    const correct = termBank[index % termBank.length];
    const distractors = termBank
      .filter((term) => term !== correct)
      .slice(index % 5, (index % 5) + 3);
    while (distractors.length < 3) {
      distractors.push(`distractor ${index + distractors.length + 1}`);
    }
    const options = [correct, ...distractors]
      .sort(() => Math.random() - 0.5)
      .map((item) => item.charAt(0).toUpperCase() + item.slice(1));
    const correctIndex = options.findIndex(
      (option) => option.toLowerCase() === correct.toLowerCase()
    );
    const stem = stems[index % stems.length];

    return {
      id: uid('q'),
      text: `${stem} (Question ${index + 1})`,
      options,
      correctIndex: correctIndex >= 0 ? correctIndex : 0
    };
  });
}

function addTeacherAlert(teacherId, studentId, testId, message, type = 'info') {
  pushNotification({
    recipientRole: 'teacher',
    recipientId: teacherId,
    teacherId,
    studentId,
    testId,
    type,
    message
  });
  pushNotification({
    recipientRole: 'admin',
    teacherId,
    studentId,
    testId,
    type,
    message
  });
}

function renderTeacherDashboard() {
  clearTestSession();

  const teacher = getCurrentTeacher();
  if (!teacher) {
    renderTeacherLogin();
    return;
  }

  const workspace = getTeacherWorkspace(teacher.id);
  const students = getTeacherStudents(teacher.id);
  const tests = getTeacherTests(teacher.id);
  const teacherMessages = state.messages
    .map(normalizeMessage)
    .filter((message) => message.teacherId === teacher.id);
  const teacherNotifications = getNotifications('teacher', teacher.id).slice(0, 20);
  const teacherUnread = unreadNotificationCount('teacher', teacher.id);
  const teacherView = state.feedback.teacherView || 'overview';
  const teacherSubjectFilter = state.feedback.teacherSubjectFilter || 'all';
  const teacherStudentSearch = state.feedback.teacherStudentSearch || '';
  const normalizedTeacherSearch = teacherStudentSearch.trim().toLowerCase();
  const filteredTeacherStudents = students.filter((student) => {
    const subjectMatch =
      teacherSubjectFilter === 'all' ? true : studentHasSubject(student, teacherSubjectFilter);
    const name = `${student.firstName} ${student.lastName}`.toLowerCase();
    const nameMatch = !normalizedTeacherSearch || name.includes(normalizedTeacherSearch);
    return subjectMatch && nameMatch;
  });
  const selectedStudent =
    students.find((student) => student.id === state.feedback.teacherSelectedStudentId) || null;

  const testsToday = tests.filter((test) => isToday(test.createdAt)).length;
  const avgScore = averageScoreForTeacher(teacher.id);

  app.innerHTML = `
    <div class="dashboard-shell">
      <header class="main-nav">
        <div class="left-nav">
          ${brandLogo(true)}
          <button class="nav-tab ${teacherView === 'overview' ? 'active' : ''}" data-teacher-view="overview">Overview</button>
          <button class="nav-tab ${teacherView === 'students' ? 'active' : ''}" data-teacher-view="students">Students</button>
          <button class="nav-tab ${teacherView === 'resources' ? 'active' : ''}" data-teacher-view="resources">Upload Resources</button>
          <button class="nav-tab ${teacherView === 'tests' ? 'active' : ''}" data-teacher-view="tests">Conduct Test</button>
          <button class="nav-tab ${teacherView === 'messages' ? 'active' : ''}" data-teacher-view="messages">Messages</button>
          <button class="nav-tab ${teacherView === 'notifications' ? 'active' : ''}" data-teacher-view="notifications">
            Notifications
            <span class="notif-badge">${teacherUnread}</span>
          </button>
          <button class="nav-tab ${teacherView === 'accounts' ? 'active' : ''}" data-teacher-view="accounts">Accounts</button>
        </div>
        <div class="top-actions">
          <button class="notif-btn" id="teacherNotifBtn">
            Notifications
            <span class="notif-badge">${teacherUnread}</span>
          </button>
          <button class="signout" id="logoutBtn">Sign Out</button>
        </div>
      </header>

      <main class="page container-xl">
        <h2>Welcome, ${teacher.fullName}</h2>
        <p class="subline">Clean workspace with section-based navigation for daily operations.</p>

        ${teacher.mustChangePassword
          ? `
            <section class="alert-card">
              <div>
                <h3>Password Update Required</h3>
                <p>You are using a temporary password. Open Accounts and set a new password.</p>
              </div>
              <span class="alert-tag">Account</span>
            </section>
          `
          : ''}

        <section class="stats-grid">
          <article class="panel stat"><h3>${students.length}</h3><p>Total Students</p></article>
          <article class="panel stat"><h3>${testsToday}</h3><p>Tests Conducted Today</p></article>
          <article class="panel stat"><h3>${teacherMessages.length}</h3><p>Conversation Items</p></article>
          <article class="panel stat"><h3>${avgScore}%</h3><p>Avg. Score</p></article>
        </section>

        ${teacherView === 'overview'
          ? `
          <section class="panel">
            <h3>Create Subjects (Free Trial)</h3>
            <p class="muted">Limit: ${workspace.subjects.length}/${state.trialLimits.subjectsPerTeacher}</p>
            <label for="subjectNameInput">Subject Name</label>
            <input id="subjectNameInput" placeholder="e.g. Mathematics" />
            <label for="subjectSyllabusPdf">Upload Syllabus PDF</label>
            <input id="subjectSyllabusPdf" type="file" accept=".pdf,application/pdf" />
            <button class="cta-main" id="addSubjectBtn">Add Subject</button>
            <div class="pill-list">
              ${workspace.subjects.length
                ? workspace.subjects
                    .map((subject) => {
                      const hasSyllabus = Boolean(workspace.subjectSyllabi?.[subject]?.dataUrl);
                      return `<span class="pill">${subject} ${hasSyllabus ? '• PDF' : '• No PDF'}</span>`;
                    })
                    .join('')
                : '<span class="pill">No subjects yet</span>'}
            </div>
            ${workspace.subjects.length
              ? `
                <label for="subjectToUpdateSyllabus">Update Existing Subject Syllabus</label>
                <select id="subjectToUpdateSyllabus">
                  <option value="">Select subject</option>
                  ${workspace.subjects.map((subject) => `<option value="${subject}">${subject}</option>`).join('')}
                </select>
                <label for="updateSyllabusPdf">Upload New Syllabus PDF</label>
                <input id="updateSyllabusPdf" type="file" accept=".pdf,application/pdf" />
                <button class="cta-soft" id="updateSyllabusBtn">Update Syllabus PDF</button>
              `
              : ''}
            <p class="auth-note" id="subjectStatus"></p>
          </section>

          <section class="panel table-panel">
            <h3>Syllabus Manager</h3>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>PDF Name</th>
                    <th>Updated</th>
                    <th>View</th>
                    <th>Download</th>
                    <th>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  ${workspace.subjects.length
                    ? workspace.subjects
                        .map((subject) => {
                          const syllabus = workspace.subjectSyllabi?.[subject] || null;
                          return `
                            <tr>
                              <td>${subject}</td>
                              <td>${syllabus?.name || 'Not Uploaded'}</td>
                              <td>${syllabus?.createdAt ? readableDate(syllabus.createdAt) : '-'}</td>
                              <td>${syllabus ? `<button class="mini-btn" data-syllabus-view="${subject}">View</button>` : '-'}</td>
                              <td>${syllabus ? `<button class="mini-btn" data-syllabus-download="${subject}">Download</button>` : '-'}</td>
                              <td>${syllabus ? `<button class="mini-btn danger" data-syllabus-delete="${subject}">Delete</button>` : '-'}</td>
                            </tr>
                          `;
                        })
                        .join('')
                    : '<tr><td colspan="6">No subjects created yet.</td></tr>'}
                </tbody>
              </table>
            </div>
          </section>
        `
          : ''}

        ${teacherView === 'students'
          ? `
          <section class="two-grid">
            <article class="panel">
              <h3>Create Student Account</h3>
              <p class="muted">Assign one or more subjects from your subject list.</p>
              <label for="studentFirstName">First Name</label>
              <input id="studentFirstName" placeholder="First name" />

              <label for="studentLastName">Last Name</label>
              <input id="studentLastName" placeholder="Last name" />

              <label for="studentPhone">Phone Number</label>
              <input id="studentPhone" placeholder="10-digit phone" />

              <label for="studentEmail">Email</label>
              <input id="studentEmail" placeholder="student@email.com" />

              <label for="studentSubjects">Subjects (select one or more)</label>
              <select id="studentSubjects" multiple size="${Math.min(6, Math.max(3, workspace.subjects.length || 3))}">
                ${workspace.subjects.map((subject) => `<option value="${subject}">${subject}</option>`).join('')}
              </select>
              <p class="muted">Use Ctrl/Cmd (or long-press on mobile) to select multiple subjects.</p>

              <button class="cta-main" id="createStudentBtn">Create Student Account</button>
              <p class="auth-note" id="studentCreateStatus">${state.feedback.teacherActionStatus}</p>
            </article>

            <article class="panel">
              <h3>Share Credentials</h3>
              <button class="cta-soft" id="exportStudentsCsvBtn">Export Students CSV</button>
              <p class="muted">Use Email or WhatsApp links from the table below to share usernames.</p>
            </article>
          </section>

          <section class="panel table-panel">
            <h3>Students, Scores and Profile</h3>
            <label for="teacherSubjectFilter">Filter by subject</label>
            <select id="teacherSubjectFilter">
              <option value="all" ${teacherSubjectFilter === 'all' ? 'selected' : ''}>All Subjects</option>
              ${workspace.subjects.map((subject) => `<option value="${subject}" ${teacherSubjectFilter === subject ? 'selected' : ''}>${subject}</option>`).join('')}
            </select>

            <label for="teacherStudentSearch">Search by student name</label>
            <input id="teacherStudentSearch" value="${teacherStudentSearch}" placeholder="Type student name..." />

            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Subjects</th>
                    <th>Username</th>
                    <th>Avg Score</th>
                    <th>Password</th>
                    <th>Email</th>
                    <th>WhatsApp</th>
                    <th>Profile</th>
                    <th>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  ${filteredTeacherStudents.length
                    ? filteredTeacherStudents
                        .map((student) => {
                          const name = `${student.firstName} ${student.lastName}`;
                          const credentialLine = student.password
                            ? `your username is ${student.username} and your temporary password is ${student.password}. Please login and change password in Accounts.`
                            : `your username is ${student.username}. Please open student login and set your password.`;
                          const emailBody = encodeURIComponent(
                            `Hello ${name}, ${credentialLine}`
                          );
                          const emailHref = `mailto:${student.email}?subject=${encodeURIComponent('Your Student Username')}&body=${emailBody}`;
                          const phoneDigits = String(student.phone).replace(/[^0-9]/g, '');
                          const waNumber = phoneDigits.length === 10 ? `91${phoneDigits}` : phoneDigits;
                          const waText = encodeURIComponent(
                            `Hello ${name}, ${credentialLine}`
                          );
                          const waHref = `https://wa.me/${waNumber}?text=${waText}`;
                          return `
                            <tr>
                              <td>${name}</td>
                              <td>${studentSubjects(student).join(', ')}</td>
                              <td>${student.username}</td>
                              <td>${averageScoreForStudent(student)}%</td>
                              <td>${student.password ? 'Set' : 'Pending'}</td>
                              <td><a href="${emailHref}" target="_blank" rel="noreferrer">Email</a></td>
                              <td><a href="${waHref}" target="_blank" rel="noreferrer">WhatsApp</a></td>
                              <td><button class="mini-btn" data-teacher-student="${student.id}">View</button></td>
                              <td><button class="mini-btn danger" data-teacher-delete-student="${student.id}">Delete</button></td>
                            </tr>
                          `;
                        })
                        .join('')
                    : '<tr><td colspan="9">No students found for selected filter/search.</td></tr>'}
                </tbody>
              </table>
            </div>
          </section>

          ${selectedStudent
            ? `
            <section class="panel">
              <h3>Profile: ${selectedStudent.firstName} ${selectedStudent.lastName}</h3>
              <p class="muted">Phone: ${selectedStudent.phone} | Email: ${selectedStudent.email}</p>
              <p class="muted">Subjects: ${studentSubjects(selectedStudent).join(', ') || '-'} | Username: ${selectedStudent.username}</p>
              <label for="addSubjectToStudent">Add Subject</label>
              <select id="addSubjectToStudent">
                <option value="">Choose subject</option>
                ${workspace.subjects
                  .filter((subject) => !studentHasSubject(selectedStudent, subject))
                  .map((subject) => `<option value="${subject}">${subject}</option>`)
                  .join('')}
              </select>
              <button class="cta-soft" id="addSubjectToStudentBtn">Add Subject to Student</button>
              <p class="auth-note" id="addSubjectToStudentStatus"></p>
              ${scoreHistoryMarkup(selectedStudent)}

              <label for="teacherMessageToStudent">Send Message</label>
              <textarea id="teacherMessageToStudent" rows="3" placeholder="Type message to this student..."></textarea>
              <button class="cta-soft" id="teacherSendStudentMessageBtn">Send Message</button>
              <p class="auth-note" id="teacherStudentMessageStatus"></p>
            </section>
          `
            : ''}
        `
          : ''}

        ${teacherView === 'resources'
          ? `
          <section class="panel">
            <h3>Upload Resource</h3>
            <p class="muted">Choose subject and resource type before uploading details.</p>
            <label for="resourceSubject">Subject</label>
            <select id="resourceSubject">
              <option value="">Select subject</option>
              ${workspace.subjects.map((subject) => `<option value="${subject}">${subject}</option>`).join('')}
            </select>

            <label for="resourceType">Resource Type</label>
            <select id="resourceType">
              <option value="pdf">PDF</option>
              <option value="ebook">Ebook</option>
              <option value="video">Video (YouTube Link)</option>
              <option value="link">Link</option>
            </select>

            <label for="resourceFile">Upload File (PDF / Ebook)</label>
            <input id="resourceFile" type="file" />

            <label for="resourceValue">Link or Reference</label>
            <input id="resourceValue" placeholder="Paste link (for link type) or optional reference" />

            <button class="cta-main" id="uploadResourceBtn">Upload Resource</button>
            <p class="auth-note" id="resourceUploadStatus"></p>
          </section>

          <section class="panel table-panel">
            <h3>Uploaded Resources</h3>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Type</th>
                    <th>Value</th>
                    <th>Source</th>
                    <th>Uploaded</th>
                    <th>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  ${workspace.resourceLibrary.length
                    ? workspace.resourceLibrary
                        .slice()
                        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                        .map((resource) => `
                          <tr>
                            <td>${resource.subject}</td>
                            <td>${resource.resourceType.toUpperCase()}</td>
                            <td>${resource.resourceValue}</td>
                            <td>${resource.resourceSource === 'file' ? 'File Upload' : 'Link/Reference'}</td>
                            <td>${readableDate(resource.createdAt)}</td>
                            <td><button class="mini-btn danger" data-delete-resource="${resource.id}">Delete</button></td>
                          </tr>
                        `)
                        .join('')
                    : '<tr><td colspan="6">No resources uploaded yet.</td></tr>'}
                </tbody>
              </table>
            </div>
          </section>
        `
          : ''}

        ${teacherView === 'tests'
          ? `
          <section class="panel">
            <h3>Conduct Test</h3>
            <label for="testTitle">Test Title</label>
            <input id="testTitle" value="${workspace.draftTest.title}" placeholder="e.g. Chapter 5 Assessment" />

            <label for="testSubject">Subject</label>
            <select id="testSubject">
              <option value="">Select subject</option>
              ${workspace.subjects.map((subject) => `<option value="${subject}" ${workspace.draftTest.subject === subject ? 'selected' : ''}>${subject}</option>`).join('')}
            </select>

            <label for="testType">Question Type</label>
            <select id="testType">
              <option value="mcq" ${workspace.draftTest.type === 'mcq' ? 'selected' : ''}>MCQ (20 Questions / 5 Minutes)</option>
              <option value="long" ${workspace.draftTest.type === 'long' ? 'selected' : ''}>Long Format</option>
            </select>

            <div id="testBuilderContainer"></div>
            <p class="auth-note" id="testCreateStatus"></p>
          </section>

          <section class="panel table-panel">
            <h3>Published Tests</h3>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Subject</th>
                    <th>Duration</th>
                    <th>Source</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  ${tests.length
                    ? tests
                        .slice()
                        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                        .map((test) => `
                          <tr>
                            <td>${test.title}</td>
                            <td>${test.type.toUpperCase()}</td>
                            <td>${test.subject}</td>
                            <td>${test.durationMinutes} mins</td>
                            <td>${test.type === 'mcq' ? test.sourcePdfName || 'Chapter PDF' : 'Teacher Input'}</td>
                            <td>${readableDate(test.createdAt)}</td>
                          </tr>
                        `)
                        .join('')
                    : '<tr><td colspan="6">No tests published yet.</td></tr>'}
                </tbody>
              </table>
            </div>
          </section>
        `
          : ''}

        ${teacherView === 'messages'
          ? `
          <section class="panel">
            <h3>Social Communication Feed</h3>
            <div class="social-feed">
              ${teacherMessages.length
                ? teacherMessages
                    .slice()
                    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                    .map((message) => {
                      const normalized = normalizeMessage(message);
                      const senderRole =
                        normalized.fromRole === 'teacher'
                          ? 'teacher'
                          : normalized.fromRole === 'student'
                            ? 'student'
                            : 'admin';
                      const senderId =
                        normalized.fromRole === 'teacher'
                          ? teacher.id
                          : normalized.fromRole === 'student'
                            ? normalized.studentId
                            : 'admin';
                      const senderName = messageSenderLabel(normalized);
                      return `
                      <article class="feed-card ${normalized.fromRole === 'teacher' ? 'mine' : ''}">
                        <div class="feed-meta">
                          <div class="feed-user">
                            ${avatarMarkup(senderRole, senderId, senderName)}
                            <strong>${senderName}</strong>
                          </div>
                          <small>${readableDate(normalized.createdAt)}</small>
                        </div>
                        <p>${normalized.text}</p>
                      </article>
                    `;
                    })
                    .join('')
                : '<p class="muted">No messages yet.</p>'}
            </div>

            <label for="teacherMessageStudentSelect">Select Student</label>
            <select id="teacherMessageStudentSelect">
              <option value="">Choose student</option>
              ${students.map((student) => `<option value="${student.id}">${student.firstName} ${student.lastName}</option>`).join('')}
            </select>

            <label for="teacherMessageInput">Message</label>
            <textarea id="teacherMessageInput" rows="3" placeholder="Type message for selected student..."></textarea>
            <button class="cta-soft" id="teacherSendMessageBtn">Send Message</button>
            <p class="auth-note" id="teacherMessageStatus"></p>
          </section>
        `
          : ''}

        ${teacherView === 'notifications'
          ? `
          <section class="panel">
            <h3>Teacher Notifications</h3>
            <div class="social-feed">
              ${teacherNotifications.length
                ? teacherNotifications
                    .map((notification) => `
                      <article class="feed-card">
                        <div class="feed-meta">
                          <strong>${notification.type.replace('-', ' ').toUpperCase()}</strong>
                          <small>${readableDate(notification.createdAt)}</small>
                        </div>
                        <p>${notification.message}</p>
                        ${notification.type === 'student-password-reset-request' && notification.studentId
                          ? `<button class="mini-btn" data-teacher-reset-student="${notification.studentId}">Set New Password</button>`
                          : ''}
                      </article>
                    `)
                    .join('')
                : '<p class="muted">No notifications yet.</p>'}
            </div>
          </section>
        `
          : ''}

        ${teacherView === 'accounts'
          ? `
          <section class="panel">
            <h3>Account Settings</h3>
            <div class="account-card">
              ${avatarMarkup('teacher', teacher.id, teacher.fullName)}
              <div>
                <strong>${teacher.fullName}</strong>
                <p class="muted">${teacher.email || teacher.username}</p>
              </div>
            </div>

            <label for="teacherProfileUpload">Upload Profile Picture</label>
            <input id="teacherProfileUpload" type="file" accept="image/*" />

            <label for="teacherNewPassword">New Password</label>
            <input id="teacherNewPassword" type="password" placeholder="Enter new password" />

            <label for="teacherConfirmPassword">Confirm New Password</label>
            <input id="teacherConfirmPassword" type="password" placeholder="Confirm new password" />

            <button class="cta-main" id="saveTeacherAccountBtn">Save Account Changes</button>
            <p class="auth-note" id="teacherAccountStatus"></p>
          </section>
        `
          : ''}
      </main>
    </div>
  `;

  if (teacherView === 'tests') {
    renderTeacherTestBuilder(workspace);
  }

  document.getElementById('logoutBtn').addEventListener('click', logoutToWelcome);

  document.querySelectorAll('[data-teacher-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.feedback.teacherView = button.dataset.teacherView;
      if (button.dataset.teacherView === 'notifications') {
        markNotificationsRead('teacher', teacher.id);
      }
      saveState();
      renderTeacherDashboard();
    });
  });

  document.getElementById('teacherNotifBtn').addEventListener('click', () => {
    state.feedback.teacherView = 'notifications';
    markNotificationsRead('teacher', teacher.id);
    saveState();
    renderTeacherDashboard();
  });

  const addSubjectBtn = document.getElementById('addSubjectBtn');
  if (addSubjectBtn) {
    addSubjectBtn.addEventListener('click', async () => {
      const subject = sanitizeValue(document.getElementById('subjectNameInput').value);
      const syllabusFile =
        document.getElementById('subjectSyllabusPdf').files[0] || null;
      const status = document.getElementById('subjectStatus');

      if (!subject) {
        status.textContent = 'Enter a subject name.';
        return;
      }

      if (!syllabusFile) {
        status.textContent = 'Upload syllabus PDF before creating the subject.';
        return;
      }

      if (!/\.pdf$/i.test(syllabusFile.name)) {
        status.textContent = 'Syllabus must be a PDF file.';
        return;
      }

      if (workspace.subjects.length >= state.trialLimits.subjectsPerTeacher) {
        status.textContent =
          `Subject limit reached. Max ${state.trialLimits.subjectsPerTeacher} for free trial.`;
        return;
      }

      const exists = workspace.subjects.some(
        (existing) => existing.toLowerCase() === subject.toLowerCase()
      );
      if (exists) {
        status.textContent = 'This subject already exists.';
        return;
      }

      const syllabusDataUrl = await fileToDataUrl(syllabusFile);
      workspace.subjects.push(subject);
      workspace.subjectSyllabi[subject] = {
        name: syllabusFile.name,
        dataUrl: syllabusDataUrl,
        createdAt: nowIso()
      };
      saveState();
      renderTeacherDashboard();
    });
  }

  const updateSyllabusBtn = document.getElementById('updateSyllabusBtn');
  if (updateSyllabusBtn) {
    updateSyllabusBtn.addEventListener('click', async () => {
      const subject = document.getElementById('subjectToUpdateSyllabus').value;
      const syllabusFile = document.getElementById('updateSyllabusPdf').files[0] || null;
      const status = document.getElementById('subjectStatus');

      if (!subject) {
        status.textContent = 'Select a subject to update syllabus.';
        return;
      }
      if (!syllabusFile || !/\.pdf$/i.test(syllabusFile.name)) {
        status.textContent = 'Please upload a valid PDF syllabus file.';
        return;
      }

      workspace.subjectSyllabi[subject] = {
        name: syllabusFile.name,
        dataUrl: await fileToDataUrl(syllabusFile),
        createdAt: nowIso()
      };
      saveState();
      status.textContent = `Syllabus updated for ${subject}.`;
      renderTeacherDashboard();
    });
  }

  document.querySelectorAll('[data-syllabus-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const subject = button.dataset.syllabusView;
      const syllabus = workspace.subjectSyllabi?.[subject];
      if (!syllabus?.dataUrl) return;
      window.open(syllabus.dataUrl, '_blank', 'noopener,noreferrer');
    });
  });

  document.querySelectorAll('[data-syllabus-download]').forEach((button) => {
    button.addEventListener('click', () => {
      const subject = button.dataset.syllabusDownload;
      const syllabus = workspace.subjectSyllabi?.[subject];
      if (!syllabus?.dataUrl) return;
      const anchor = document.createElement('a');
      anchor.href = syllabus.dataUrl;
      anchor.download = syllabus.name || `${subject}-syllabus.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    });
  });

  document.querySelectorAll('[data-syllabus-delete]').forEach((button) => {
    button.addEventListener('click', () => {
      const subject = button.dataset.syllabusDelete;
      if (!workspace.subjectSyllabi?.[subject]) return;
      const confirmed = confirm(`Delete syllabus PDF for ${subject}?`);
      if (!confirmed) return;
      delete workspace.subjectSyllabi[subject];
      saveState();
      renderTeacherDashboard();
    });
  });

  const createStudentBtn = document.getElementById('createStudentBtn');
  if (createStudentBtn) {
    createStudentBtn.addEventListener('click', () => {
      const firstName = sanitizeValue(document.getElementById('studentFirstName').value);
      const lastName = sanitizeValue(document.getElementById('studentLastName').value);
      const phone = sanitizeValue(document.getElementById('studentPhone').value);
      const email = sanitizeValue(document.getElementById('studentEmail').value.toLowerCase());
      const selectedSubjects = Array.from(
        document.getElementById('studentSubjects').selectedOptions
      ).map((option) => option.value);

      if (!firstName || !lastName || !phone || !email || !selectedSubjects.length) {
        state.feedback.teacherActionStatus = 'Please fill all student fields and choose at least one subject.';
        saveState();
        renderTeacherDashboard();
        return;
      }

      const studentId = uid('student');
      const username = generateUniqueStudentUsername(firstName, lastName);

      state.students[studentId] = {
        id: studentId,
        teacherId: teacher.id,
        firstName,
        lastName,
        phone,
        email,
        subject: selectedSubjects[0],
        subjects: selectedSubjects,
        username,
        password: '',
        passwordSetAt: null,
        profileImage: '',
        mustChangePassword: false,
        videoNotes: {},
        usageSeconds: 0,
        attempts: [],
        createdAt: nowIso()
      };

      workspace.studentIds.push(studentId);
      state.feedback.teacherActionStatus =
        `Student created. Username: ${username}. Share by Email/WhatsApp/CSV.`;
      saveState();
      renderTeacherDashboard();
    });
  }

  const exportStudentsCsvBtn = document.getElementById('exportStudentsCsvBtn');
  if (exportStudentsCsvBtn) {
    exportStudentsCsvBtn.addEventListener('click', () => {
      const rows = students.map((student) => [
        student.firstName,
        student.lastName,
        student.phone,
        student.email,
        studentSubjects(student).join(', '),
        student.username,
        student.password ? 'Password Set' : 'Set Password Pending'
      ]);

      downloadCsv(
        `students-${teacher.username}.csv`,
        ['First Name', 'Last Name', 'Phone', 'Email', 'Subjects', 'Username', 'Password Status'],
        rows
      );
    });
  }

  document.querySelectorAll('[data-teacher-student]').forEach((button) => {
    button.addEventListener('click', () => {
      state.feedback.teacherSelectedStudentId = button.dataset.teacherStudent;
      saveState();
      renderTeacherDashboard();
    });
  });

  const teacherSubjectFilterNode = document.getElementById('teacherSubjectFilter');
  if (teacherSubjectFilterNode) {
    teacherSubjectFilterNode.addEventListener('change', (event) => {
      state.feedback.teacherSubjectFilter = event.target.value;
      saveState();
      renderTeacherDashboard();
    });
  }

  const teacherStudentSearchNode = document.getElementById('teacherStudentSearch');
  if (teacherStudentSearchNode) {
    teacherStudentSearchNode.addEventListener('input', (event) => {
      state.feedback.teacherStudentSearch = event.target.value;
      saveState();
      renderTeacherDashboard();
    });
  }

  document.querySelectorAll('[data-teacher-delete-student]').forEach((button) => {
    button.addEventListener('click', () => {
      const studentId = button.dataset.teacherDeleteStudent;
      const student = state.students[studentId];
      if (!student) return;

      const confirmed = confirm(
        `Delete ${student.firstName} ${student.lastName}? This cannot be undone in this prototype.`
      );
      if (!confirmed) return;

      if (deleteStudentRecord(studentId)) {
        saveState();
        renderTeacherDashboard();
      }
    });
  });

  const teacherSendStudentMessageBtn = document.getElementById('teacherSendStudentMessageBtn');
  if (teacherSendStudentMessageBtn && selectedStudent) {
    teacherSendStudentMessageBtn.addEventListener('click', () => {
      const text = sanitizeValue(document.getElementById('teacherMessageToStudent').value);
      const status = document.getElementById('teacherStudentMessageStatus');
      if (!text) {
        status.textContent = 'Type a message first.';
        return;
      }

      sendMessage({
        fromRole: 'teacher',
        fromId: teacher.id,
        toRole: 'student',
        toId: selectedStudent.id,
        studentId: selectedStudent.id,
        teacherId: teacher.id,
        text
      });
      pushNotification({
        recipientRole: 'student',
        recipientId: selectedStudent.id,
        studentId: selectedStudent.id,
        teacherId: teacher.id,
        type: 'new-message',
        message: `New message from ${teacher.fullName}.`
      });
      saveState();
      status.textContent = 'Message sent.';
      renderTeacherDashboard();
    });
  }

  const addSubjectToStudentBtn = document.getElementById('addSubjectToStudentBtn');
  if (addSubjectToStudentBtn && selectedStudent) {
    addSubjectToStudentBtn.addEventListener('click', () => {
      const subject = document.getElementById('addSubjectToStudent').value;
      const status = document.getElementById('addSubjectToStudentStatus');
      if (!subject) {
        status.textContent = 'Choose a subject first.';
        return;
      }
      if (!Array.isArray(selectedStudent.subjects)) {
        selectedStudent.subjects = selectedStudent.subject ? [selectedStudent.subject] : [];
      }
      if (selectedStudent.subjects.includes(subject)) {
        status.textContent = 'Student already has this subject.';
        return;
      }

      selectedStudent.subjects.push(subject);
      if (!selectedStudent.subject) {
        selectedStudent.subject = subject;
      }
      saveState();
      renderTeacherDashboard();
    });
  }

  const uploadResourceBtn = document.getElementById('uploadResourceBtn');
  const resourceTypeNode = document.getElementById('resourceType');
  const resourceFileNode = document.getElementById('resourceFile');
  const resourceValueNode = document.getElementById('resourceValue');
  if (resourceTypeNode && resourceFileNode) {
    const applyResourceFileRules = () => {
      const selectedType = resourceTypeNode.value;
      resourceFileNode.accept = resourceAcceptForType(selectedType);
      resourceFileNode.disabled = selectedType === 'link' || selectedType === 'video';
      if (selectedType === 'link' || selectedType === 'video') {
        resourceFileNode.value = '';
      }
      if (resourceValueNode) {
        resourceValueNode.placeholder =
          selectedType === 'video'
            ? 'Paste YouTube link (required for video)'
            : selectedType === 'link'
              ? 'Paste resource link'
              : 'Optional link/reference';
      }
    };

    applyResourceFileRules();
    resourceTypeNode.addEventListener('change', applyResourceFileRules);
  }

  if (uploadResourceBtn) {
    uploadResourceBtn.addEventListener('click', async () => {
      const subject = document.getElementById('resourceSubject').value;
      const resourceType = document.getElementById('resourceType').value;
      const resourceValue = sanitizeValue(document.getElementById('resourceValue').value);
      const resourceFile = document.getElementById('resourceFile').files[0] || null;
      const status = document.getElementById('resourceUploadStatus');

      const hasTextValue = Boolean(resourceValue);
      const hasFileValue = Boolean(resourceFile);
      if (!subject || !resourceType) {
        status.textContent = 'Please choose subject and resource type.';
        return;
      }

      if (resourceType === 'video') {
        if (!hasTextValue || !isYoutubeUrl(resourceValue)) {
          status.textContent = 'Video must be a valid YouTube link.';
          return;
        }
      } else if (!hasTextValue && !hasFileValue) {
        status.textContent = 'Please choose subject/type and provide a file or link.';
        return;
      }

      if (resourceType === 'link' && !hasTextValue) {
        status.textContent = 'For link type, please paste a valid link.';
        return;
      }

      if ((resourceType === 'pdf' || resourceType === 'ebook') && hasFileValue && !resourceFile) {
        status.textContent = 'Please select a valid file.';
        return;
      }

      let dataUrl = '';
      let resourceKeywords = [];
      if (hasFileValue && (resourceType === 'pdf' || resourceType === 'ebook')) {
        dataUrl = await fileToDataUrl(resourceFile);
        if (/\.pdf$/i.test(resourceFile.name)) {
          const pdfText = await extractPdfText(resourceFile, 12);
          resourceKeywords = extractKeywordsFromText(
            `${resourceFile.name} ${pdfText}`,
            36
          );
        } else {
          resourceKeywords = extractKeywordsFromText(resourceFile.name, 18);
        }
      } else {
        resourceKeywords = extractKeywordsFromText(resourceValue, 18);
      }

      const finalValue = hasFileValue ? resourceFile.name : resourceValue;
      const source = hasFileValue ? 'file' : 'text';
      const resourceEntry = {
        id: uid('resource'),
        subject,
        resourceType,
        resourceValue: finalValue,
        resourceSource: source,
        resourceDataUrl: dataUrl,
        resourceKeywords,
        fileMime: resourceFile ? resourceFile.type : '',
        fileSize: resourceFile ? resourceFile.size : 0,
        createdAt: nowIso()
      };
      resourceEntry.resourceSearchText = buildResourceSearchText(resourceEntry);

      workspace.resourceLibrary.push(resourceEntry);

      getTeacherStudents(teacher.id)
        .filter((student) => studentHasSubject(student, subject))
        .forEach((student) => {
          pushNotification({
            recipientRole: 'student',
            recipientId: student.id,
            studentId: student.id,
            teacherId: teacher.id,
            type: 'new-resource',
            message: `New ${resourceType.toUpperCase()} resource uploaded for ${subject}.`
          });
        });

      saveState();
      status.textContent =
        resourceType === 'video'
          ? 'Video lesson saved.'
          : hasFileValue
            ? `File uploaded: ${resourceFile.name}`
            : 'Resource link/reference saved.';
      renderTeacherDashboard();
    });
  }

  document.querySelectorAll('[data-delete-resource]').forEach((button) => {
    button.addEventListener('click', () => {
      const resourceId = button.dataset.deleteResource;
      const confirmed = confirm('Delete this uploaded resource?');
      if (!confirmed) return;

      if (deleteResourceRecord(teacher.id, resourceId)) {
        saveState();
        renderTeacherDashboard();
      }
    });
  });

  const teacherSendMessageBtn = document.getElementById('teacherSendMessageBtn');
  if (teacherSendMessageBtn) {
    teacherSendMessageBtn.addEventListener('click', () => {
      const studentId = document.getElementById('teacherMessageStudentSelect').value;
      const text = sanitizeValue(document.getElementById('teacherMessageInput').value);
      const status = document.getElementById('teacherMessageStatus');
      if (!studentId || !text) {
        status.textContent = 'Choose student and type message.';
        return;
      }

      const student = state.students[studentId];
      sendMessage({
        fromRole: 'teacher',
        fromId: teacher.id,
        toRole: 'student',
        toId: studentId,
        studentId,
        teacherId: teacher.id,
        text
      });
      pushNotification({
        recipientRole: 'student',
        recipientId: studentId,
        studentId,
        teacherId: teacher.id,
        type: 'new-message',
        message: `New message from ${teacher.fullName}.`
      });
      saveState();
      status.textContent = `Message sent to ${student.firstName} ${student.lastName}.`;
      renderTeacherDashboard();
    });
  }

  document.querySelectorAll('[data-teacher-reset-student]').forEach((button) => {
    button.addEventListener('click', () => {
      const studentId = button.dataset.teacherResetStudent;
      const targetStudent = state.students[studentId];
      if (!targetStudent || targetStudent.teacherId !== teacher.id) return;

      const proposed = prompt(
        `Set new password for ${targetStudent.firstName} ${targetStudent.lastName}:`,
        generateTempPassword()
      );
      if (!proposed) return;

      const cleanPassword = sanitizeValue(proposed);
      if (!cleanPassword) return;

      targetStudent.password = cleanPassword;
      targetStudent.passwordSetAt = nowIso();
      targetStudent.mustChangePassword = true;

      pushNotification({
        recipientRole: 'student',
        recipientId: targetStudent.id,
        studentId: targetStudent.id,
        teacherId: teacher.id,
        type: 'password-reset',
        message: `Teacher reset your password. Temporary password: ${cleanPassword}. Please change it from Accounts after login.`
      });
      pushNotification({
        recipientRole: 'admin',
        studentId: targetStudent.id,
        teacherId: teacher.id,
        type: 'password-reset',
        message: `${teacher.fullName} reset password for ${targetStudent.firstName} ${targetStudent.lastName}.`
      });
      saveState();
      renderTeacherDashboard();
    });
  });

  const saveTeacherAccountBtn = document.getElementById('saveTeacherAccountBtn');
  if (saveTeacherAccountBtn) {
    saveTeacherAccountBtn.addEventListener('click', async () => {
      const newPassword = document.getElementById('teacherNewPassword').value.trim();
      const confirmPassword = document.getElementById('teacherConfirmPassword').value.trim();
      const profileFile = document.getElementById('teacherProfileUpload').files[0] || null;
      const status = document.getElementById('teacherAccountStatus');

      if (newPassword || confirmPassword) {
        if (newPassword.length < 6) {
          status.textContent = 'Password must be at least 6 characters.';
          return;
        }
        if (newPassword !== confirmPassword) {
          status.textContent = 'Passwords do not match.';
          return;
        }
        teacher.password = newPassword;
        teacher.mustChangePassword = false;
      }

      if (profileFile) {
        teacher.profileImage = await fileToDataUrl(profileFile);
      }

      saveState();
      status.textContent = 'Account updated successfully.';
      renderTeacherDashboard();
    });
  }
}

function renderTeacherTestBuilder(workspace) {
  const container = document.getElementById('testBuilderContainer');
  if (!container) return;

  if (workspace.draftTest.type === 'mcq') {
    container.innerHTML = `
      <div class="builder-box">
        <p class="muted">Upload a chapter PDF and the system will generate ${MCQ_QUESTION_LIMIT} MCQs automatically. Student timer is fixed to ${MCQ_DURATION_MINUTES} minutes.</p>

        <label for="mcqSourcePdf">Chapter PDF</label>
        <input id="mcqSourcePdf" type="file" accept=".pdf,application/pdf" />
        <button class="cta-soft" id="generateMcqFromPdfBtn">Generate 20 MCQs from PDF</button>

        <p class="auth-note">
          ${workspace.draftTest.mcqSourcePdfName
            ? `Last chapter PDF: ${workspace.draftTest.mcqSourcePdfName}`
            : 'No chapter PDF processed yet.'}
        </p>

        <p class="auth-note">Current count: ${workspace.draftTest.mcqQuestions.length}/${MCQ_QUESTION_LIMIT}</p>

        <div class="stack">
          ${(() => {
            const recentQuestions = workspace.draftTest.mcqQuestions.slice(-5);
            const startNumber =
              workspace.draftTest.mcqQuestions.length - recentQuestions.length + 1;
            return recentQuestions
              .map(
                (question, index) =>
                  `<p class="stack-item">Q${startNumber + index}: ${question.text}</p>`
              )
              .join('');
          })()}
        </div>

        <button class="cta-main" id="publishMcqTestBtn">Publish MCQ Test</button>
      </div>
    `;

    document.getElementById('generateMcqFromPdfBtn').addEventListener('click', async () => {
      const status = document.getElementById('testCreateStatus');
      const subject = document.getElementById('testSubject').value;
      const sourcePdf = document.getElementById('mcqSourcePdf').files[0] || null;

      if (!subject) {
        status.textContent = 'Choose subject before generating MCQ from chapter PDF.';
        return;
      }
      if (!sourcePdf || !/\.pdf$/i.test(sourcePdf.name)) {
        status.textContent = 'Please upload a valid chapter PDF.';
        return;
      }

      const chapterTitle = chapterTitleFromPdfName(sourcePdf.name);
      const terms = await extractTermsFromPdf(sourcePdf);
      workspace.draftTest.mcqQuestions = buildGeneratedMcqQuestions(
        chapterTitle,
        subject,
        terms
      );
      workspace.draftTest.mcqSourcePdfName = sourcePdf.name;
      saveState();
      renderTeacherDashboard();
    });

    document.getElementById('publishMcqTestBtn').addEventListener('click', () => {
      const status = document.getElementById('testCreateStatus');
      const title = sanitizeValue(document.getElementById('testTitle').value);
      const subject = document.getElementById('testSubject').value;

      if (!title || !subject) {
        status.textContent = 'Provide test title and subject before publishing.';
        return;
      }

      if (!workspace.draftTest.mcqSourcePdfName) {
        status.textContent = 'Generate MCQs from a chapter PDF first.';
        return;
      }

      if (workspace.draftTest.mcqQuestions.length !== MCQ_QUESTION_LIMIT) {
        status.textContent = `MCQ test needs exactly ${MCQ_QUESTION_LIMIT} questions.`;
        return;
      }

      const testId = uid('test');
      state.tests[testId] = {
        id: testId,
        teacherId: state.auth.currentTeacherId,
        title,
        subject,
        type: 'mcq',
        durationMinutes: MCQ_DURATION_MINUTES,
        sourcePdfName: workspace.draftTest.mcqSourcePdfName,
        questions: workspace.draftTest.mcqQuestions,
        createdAt: nowIso()
      };

      workspace.testIds.push(testId);
      workspace.draftTest.title = '';
      workspace.draftTest.subject = subject;
      workspace.draftTest.mcqSourcePdfName = '';
      workspace.draftTest.mcqQuestions = [];

      getTeacherStudents(state.auth.currentTeacherId)
        .filter((student) => studentHasSubject(student, subject))
        .forEach((student) => {
          pushNotification({
            recipientRole: 'student',
            recipientId: student.id,
            studentId: student.id,
            teacherId: state.auth.currentTeacherId,
            testId,
            type: 'new-test',
            message: `New MCQ test published: ${title}`
          });
        });
      saveState();
      renderTeacherDashboard();
    });
  } else {
    container.innerHTML = `
      <div class="builder-box">
        <p class="muted">Long format questions are answered inside the system within teacher-selected duration.</p>

        <label for="longQuestionsInput">Questions (one per line)</label>
        <textarea id="longQuestionsInput" rows="6" placeholder="Enter each long question on a new line"></textarea>

        <label for="longDuration">Duration</label>
        <select id="longDuration">
          ${LONG_TEST_DURATIONS.map(
            (minutes) =>
              `<option value="${minutes}" ${workspace.draftTest.durationMinutes === minutes ? 'selected' : ''}>${minutes} Minutes</option>`
          ).join('')}
        </select>

        <button class="cta-main" id="publishLongTestBtn">Publish Long Format Test</button>
      </div>
    `;

    document.getElementById('publishLongTestBtn').addEventListener('click', () => {
      const status = document.getElementById('testCreateStatus');
      const title = sanitizeValue(document.getElementById('testTitle').value);
      const subject = document.getElementById('testSubject').value;
      const durationMinutes = Number(document.getElementById('longDuration').value);
      const questions = document
        .getElementById('longQuestionsInput')
        .value.split('\n')
        .map((line) => sanitizeValue(line))
        .filter(Boolean)
        .map((prompt) => ({ id: uid('q'), prompt }));

      if (!title || !subject) {
        status.textContent = 'Provide test title and subject before publishing.';
        return;
      }

      if (!questions.length) {
        status.textContent = 'Add at least one long-format question.';
        return;
      }

      const testId = uid('test');
      state.tests[testId] = {
        id: testId,
        teacherId: state.auth.currentTeacherId,
        title,
        subject,
        type: 'long',
        durationMinutes,
        questions,
        createdAt: nowIso()
      };

      workspace.testIds.push(testId);
      workspace.draftTest.title = '';
      workspace.draftTest.subject = subject;
      workspace.draftTest.durationMinutes = durationMinutes;

      getTeacherStudents(state.auth.currentTeacherId)
        .filter((student) => studentHasSubject(student, subject))
        .forEach((student) => {
          pushNotification({
            recipientRole: 'student',
            recipientId: student.id,
            studentId: student.id,
            teacherId: state.auth.currentTeacherId,
            testId,
            type: 'new-test',
            message: `New long format test published: ${title}`
          });
        });
      saveState();
      renderTeacherDashboard();
    });
  }

  document.getElementById('testType').addEventListener('change', (event) => {
    workspace.draftTest.type = event.target.value;
    saveState();
    renderTeacherDashboard();
  });

  document.getElementById('testSubject').addEventListener('change', (event) => {
    workspace.draftTest.subject = event.target.value;
    saveState();
  });

  document.getElementById('testTitle').addEventListener('input', (event) => {
    workspace.draftTest.title = event.target.value;
    saveState();
  });
}

function startTestAttempt(testId) {
  const student = getCurrentStudent();
  const test = state.tests[testId];

  if (!student || !test) {
    renderStudentDashboard();
    return;
  }

  if (studentAttemptsForTest(student, testId)) {
    renderStudentDashboard();
    return;
  }

  bindVisibilityWarnings();
  clearTestSession();

  runtime.activeTestSession = {
    studentId: student.id,
    testId,
    startedAt: Date.now(),
    endsAt: Date.now() + test.durationMinutes * 60 * 1000,
    tabWarnings: 0
  };

  if (test.type === 'mcq') {
    renderMcqAttempt();
  } else {
    renderLongAttempt();
  }
}

function mountTimer(onExpire) {
  const timerNode = document.getElementById('timerPill');
  if (!timerNode || !runtime.activeTestSession) return;

  const update = () => {
    const remainingMs = runtime.activeTestSession.endsAt - Date.now();
    const safeMs = Math.max(0, remainingMs);
    const totalSeconds = Math.ceil(safeMs / 1000);
    const mins = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const secs = String(totalSeconds % 60).padStart(2, '0');
    timerNode.textContent = `Time Left: ${mins}:${secs}`;

    if (remainingMs <= 0) {
      clearInterval(runtime.activeTimerId);
      runtime.activeTimerId = null;
      onExpire();
    }
  };

  update();
  runtime.activeTimerId = setInterval(update, 1000);
}

function submitMcqAttempt(timeExpired = false) {
  const session = runtime.activeTestSession;
  const student = getCurrentStudent();
  const test = session ? state.tests[session.testId] : null;

  if (!session || !student || !test) {
    renderStudentDashboard();
    return;
  }

  const answers = [];
  let correctCount = 0;

  test.questions.forEach((question, index) => {
    const checked = document.querySelector(`input[name="mcq-${index}"]:checked`);
    const selectedIndex = checked ? Number(checked.value) : null;
    const isCorrect = selectedIndex === question.correctIndex;

    if (isCorrect) {
      correctCount += 1;
    }

    answers.push({
      questionId: question.id,
      questionText: question.text,
      selectedIndex,
      correctIndex: question.correctIndex,
      isCorrect
    });
  });

  const scorePercent = Math.round((correctCount / test.questions.length) * 100);
  const attempt = {
    id: uid('attempt'),
    testId: test.id,
    type: 'mcq',
    submittedAt: nowIso(),
    scorePercent,
    correctCount,
    totalQuestions: test.questions.length,
    timeSpentSeconds: Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000)),
    tabWarnings: session.tabWarnings,
    timeExpired,
    answers
  };

  student.attempts.push(attempt);
  addTeacherAlert(
    test.teacherId,
    student.id,
    test.id,
    `${student.firstName} ${student.lastName} submitted MCQ test: ${test.title}`,
    'submission'
  );
  saveState();
  clearTestSession();

  renderMcqResult(test, attempt);
}

function renderMcqAttempt() {
  const session = runtime.activeTestSession;
  const student = getCurrentStudent();
  const test = session ? state.tests[session.testId] : null;

  if (!session || !student || !test) {
    renderStudentDashboard();
    return;
  }

  app.innerHTML = `
    <div class="dashboard-shell">
      <header class="main-nav">
        <div class="left-nav">
          ${brandLogo(true)}
          <span class="nav-pill active">MCQ Test</span>
        </div>
        <span class="timer-pill" id="timerPill">Time Left: --:--</span>
      </header>

      <main class="page container-xl">
        <h2>${test.title}</h2>
        <p class="subline">${test.subject} | ${test.questions.length} Questions | ${test.durationMinutes} Minutes</p>

        <section class="panel">
          <div class="mcq-list">
            ${test.questions
              .map(
                (question, index) => `
                <article class="question-card">
                  <h3>Q${index + 1}. ${question.text}</h3>
                  <div class="options-list">
                    ${question.options
                      .map(
                        (option, optionIndex) => `
                        <label class="option-row">
                          <input type="radio" name="mcq-${index}" value="${optionIndex}" />
                          <span>${option}</span>
                        </label>
                      `
                      )
                      .join('')}
                  </div>
                </article>
              `
              )
              .join('')}
          </div>

          <button class="cta-main" id="submitMcqBtn">Submit MCQ Test</button>
        </section>
      </main>
    </div>
  `;

  document.getElementById('submitMcqBtn').addEventListener('click', () => submitMcqAttempt(false));
  mountTimer(() => submitMcqAttempt(true));
}

function renderMcqResult(test, attempt) {
  const wrongAnswers = attempt.answers.filter((answer) => !answer.isCorrect);

  app.innerHTML = `
    <div class="dashboard-shell">
      <header class="main-nav">
        <div class="left-nav">
          ${brandLogo(true)}
          <span class="nav-pill active">MCQ Result</span>
        </div>
        <button class="signout" id="backToDashboardBtn">Back to Dashboard</button>
      </header>

      <main class="page container-xl">
        <section class="panel">
          <h2>Test Completed</h2>
          <p class="subline">${test.title}</p>

          <div class="result-grid">
            <div class="result-box"><strong>${attempt.scorePercent}%</strong><p>Score</p></div>
            <div class="result-box"><strong>${attempt.correctCount}/${attempt.totalQuestions}</strong><p>Correct</p></div>
            <div class="result-box"><strong>${wrongAnswers.length}</strong><p>Wrong</p></div>
          </div>

          ${wrongAnswers.length ? '<button class="cta-soft" id="downloadAnswerKeyBtn">Download Answer Key PDF</button>' : '<p class="auth-note">Perfect score. No answer key needed.</p>'}
        </section>
      </main>
    </div>
  `;

  document.getElementById('backToDashboardBtn').addEventListener('click', renderStudentDashboard);

  if (wrongAnswers.length) {
    document.getElementById('downloadAnswerKeyBtn').addEventListener('click', () => {
      const lines = [
        `Answer Key - ${test.title}`,
        `Subject: ${test.subject}`,
        `Generated: ${readableDate(nowIso())}`,
        '',
        ...wrongAnswers.map((answer, index) => {
          const question = test.questions.find((item) => item.id === answer.questionId);
          const correct = question ? question.options[answer.correctIndex] : 'N/A';
          return `${index + 1}. ${answer.questionText} | Correct Answer: ${correct}`;
        })
      ];

      downloadPdf(`${test.title.toLowerCase().replace(/\s+/g, '-')}-answer-key.pdf`, lines);
    });
  }
}

function submitLongAttempt(timeExpired = false) {
  const session = runtime.activeTestSession;
  const student = getCurrentStudent();
  const test = session ? state.tests[session.testId] : null;

  if (!session || !student || !test) {
    renderStudentDashboard();
    return;
  }

  const answers = test.questions.map((question, index) => {
    const value = document.getElementById(`long-answer-${index}`)?.value || '';
    return {
      questionId: question.id,
      questionText: question.prompt,
      answerText: sanitizeValue(value)
    };
  });

  student.attempts.push({
    id: uid('attempt'),
    testId: test.id,
    type: 'long',
    submittedAt: nowIso(),
    scorePercent: null,
    completionPercent: Math.round(
      (answers.filter((answer) => answer.answerText.length > 0).length / answers.length) * 100
    ),
    timeSpentSeconds: Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000)),
    tabWarnings: session.tabWarnings,
    timeExpired,
    answers
  });

  addTeacherAlert(
    test.teacherId,
    student.id,
    test.id,
    `${student.firstName} ${student.lastName} submitted long test: ${test.title}`,
    'submission'
  );

  saveState();
  clearTestSession();
  renderStudentDashboard();
}

function renderLongAttempt() {
  const session = runtime.activeTestSession;
  const student = getCurrentStudent();
  const test = session ? state.tests[session.testId] : null;

  if (!session || !student || !test) {
    renderStudentDashboard();
    return;
  }

  app.innerHTML = `
    <div class="dashboard-shell">
      <header class="main-nav">
        <div class="left-nav">
          ${brandLogo(true)}
          <span class="nav-pill active">Long Format Test</span>
        </div>
        <span class="timer-pill" id="timerPill">Time Left: --:--</span>
      </header>

      <main class="page container-xl">
        <h2>${test.title}</h2>
        <p class="subline">${test.subject} | Duration: ${test.durationMinutes} minutes</p>

        <section class="panel">
          <button class="cta-soft" id="downloadLongQuestionsBtn">Download Questions</button>
          <p class="warning-note" id="tabSwitchWarning"></p>

          <div class="long-list">
            ${test.questions
              .map(
                (question, index) => `
                <article class="question-card">
                  <h3>Q${index + 1}. ${question.prompt}</h3>
                  <textarea id="long-answer-${index}" rows="4" placeholder="Write your answer here..."></textarea>
                </article>
              `
              )
              .join('')}
          </div>

          <button class="cta-main" id="submitLongBtn">Submit Long Test</button>
        </section>
      </main>
    </div>
  `;

  document.getElementById('downloadLongQuestionsBtn').addEventListener('click', () => {
    const lines = [
      `Long Test: ${test.title}`,
      `Subject: ${test.subject}`,
      `Duration: ${test.durationMinutes} minutes`,
      '',
      ...test.questions.map((question, index) => `${index + 1}. ${question.prompt}`)
    ];
    downloadTextFile(`${test.title.toLowerCase().replace(/\s+/g, '-')}-questions.txt`, lines.join('\n'));
  });

  document.getElementById('submitLongBtn').addEventListener('click', () => submitLongAttempt(false));
  mountTimer(() => submitLongAttempt(true));
}

renderWelcome();
