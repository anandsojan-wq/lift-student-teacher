const app = document.getElementById('app');

const SESSION_KEY = 'lift_live_session_v2';
const SESSION_REMEMBER_KEY = 'lift_live_session_remember_v1';
const LOGIN_HINTS_KEY = 'lift_live_login_hints_v1';
const STUDENT_TODO_KEY = 'lift_student_todos_v1';
const API_CANDIDATE_PORTS = Array.from({ length: 21 }, (_, index) => 5050 + index);
const MCQ_DEFAULT_QUESTION_COUNT = 20;
const MCQ_MIN_QUESTION_COUNT = 1;
const MCQ_MAX_QUESTION_COUNT = 100;
const MCQ_DEFAULT_DURATION_MINUTES = 5;
const NAV_TRANSITION_MS = 220;

if (typeof window !== 'undefined' && window.pdfjsLib?.GlobalWorkerOptions) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const runtime = {
  attemptTimerId: null,
  attemptSubmitting: false,
  debounceHandles: {},
  apiCache: new Map(),
  apiInFlight: new Map(),
  navTransitionTimerId: null,
  prefetchAt: new Map(),
  navOutsideClickBound: false
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

const state = {
  apiBase: '',
  apiResolved: false,
  session: loadSession(),
  loginHints: loadLoginHints(),
  authRememberMe: loadRememberPreference(),
  adminTab: 'dashboard',
  adminAnalyticsWindow: '30',
  teacherTab: 'dashboard',
  teacherClassPlanDate: todayIsoDate(),
  teacherClassPlanResourceType: 'pdf',
  studentTab: 'dashboard',
  adminTeacherSecrets: {},
  teacherStudentSecrets: {},
  adminStudentQuery: '',
  adminSubjectFilter: '',
  teacherStudentQuery: '',
  teacherSubjectFilter: '',
  teacherResourceSearch: '',
  teacherResourceType: '',
  teacherResourceCreateType: 'pdf',
  teacherResourceSubjectId: '',
  teacherTestSubjectId: '',
  teacherTestType: 'mcq',
  teacherMcqQuestionCount: '',
  teacherMcqDurationMinutes: MCQ_DEFAULT_DURATION_MINUTES,
  teacherMcqCorrectMark: 1,
  teacherMcqWrongMark: 0,
  teacherPdfDurationMinutes: 60,
  teacherPdfPreview: null,
  teacherPdfPreviewBusy: false,
  teacherTestAudienceMode: 'all',
  teacherTestSelectedStudentIds: [],
  teacherTestScheduleEnabled: false,
  teacherTestScheduleDate: todayIsoDate(),
  teacherTestScheduleStartTime: '17:00',
  teacherTestScheduleEndTime: '19:00',
  teacherViewedTestId: '',
  teacherReconductDraft: null,
  teacherAssessmentSubjectId: '',
  teacherAssessmentType: '',
  teacherAssessmentStatus: 'pending',
  teacherAssessmentQuery: '',
  studentResourceSearch: '',
  studentResourceType: '',
  studentResourceSubjectId: '',
  studentSyllabusSubjectId: '',
  studentPdfViewer: null,
  qaReports: {
    admin: null,
    teacher: null,
    student: null
  },
  qaRunningRole: ''
};

function loadSession() {
  const parseStorage = (storage) => {
    try {
      const raw = storage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.user || !parsed.institutionId) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  };

  return parseStorage(localStorage) || parseStorage(sessionStorage);
}

function loadRememberPreference() {
  return localStorage.getItem(SESSION_REMEMBER_KEY) !== '0';
}

function loadLoginHints() {
  try {
    const raw = localStorage.getItem(LOGIN_HINTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function saveLoginHints(hints) {
  state.loginHints = hints || {};
  localStorage.setItem(LOGIN_HINTS_KEY, JSON.stringify(state.loginHints));
}

function getLoginHint(role) {
  const hint = state.loginHints?.[role];
  if (!hint) return { institutionId: '', username: '' };
  return {
    institutionId: String(hint.institutionId || ''),
    username: String(hint.username || '')
  };
}

function updateLoginHint(role, institutionId, username, remember) {
  if (!role) return;
  const nextHints = { ...(state.loginHints || {}) };

  if (remember) {
    nextHints[role] = {
      institutionId: String(institutionId || '').trim(),
      username: String(username || '').trim()
    };
  } else {
    delete nextHints[role];
  }

  saveLoginHints(nextHints);
}

function loadStudentTodos(userId) {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(STUDENT_TODO_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.[userId]) ? parsed[userId] : [];
    return list
      .map((item) => ({
        id: String(item.id || `${Date.now()}-${Math.random()}`),
        text: sanitizeValue(item.text || ''),
        dueDate: String(item.dueDate || ''),
        completed: Boolean(item.completed),
        createdAt: item.createdAt || new Date().toISOString()
      }))
      .filter((item) => item.text);
  } catch (error) {
    return [];
  }
}

function saveStudentTodos(userId, todos) {
  if (!userId) return;
  let parsed = {};
  try {
    parsed = JSON.parse(localStorage.getItem(STUDENT_TODO_KEY) || '{}') || {};
  } catch (error) {
    parsed = {};
  }
  parsed[userId] = Array.isArray(todos) ? todos : [];
  localStorage.setItem(STUDENT_TODO_KEY, JSON.stringify(parsed));
}

function saveSession(session, remember = state.authRememberMe) {
  clearApiCache();
  state.session = session;
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    return;
  }

  const safeSession = {
    token: '',
    user: session.user,
    institutionId: session.institutionId
  };
  const serialized = JSON.stringify(safeSession);
  const shouldRemember = Boolean(remember);
  localStorage.setItem(SESSION_REMEMBER_KEY, shouldRemember ? '1' : '0');
  state.authRememberMe = shouldRemember;

  if (shouldRemember) {
    localStorage.setItem(SESSION_KEY, serialized);
    sessionStorage.removeItem(SESSION_KEY);
    return;
  }

  sessionStorage.setItem(SESSION_KEY, serialized);
  localStorage.removeItem(SESSION_KEY);
}

function resetUiStateOnLogout() {
  state.adminTab = 'dashboard';
  state.adminAnalyticsWindow = '30';
  state.teacherTab = 'dashboard';
  state.teacherClassPlanDate = todayIsoDate();
  state.teacherClassPlanResourceType = 'pdf';
  state.studentTab = 'dashboard';
  state.adminTeacherSecrets = {};
  state.teacherStudentSecrets = {};
  state.adminStudentQuery = '';
  state.adminSubjectFilter = '';
  state.teacherStudentQuery = '';
  state.teacherSubjectFilter = '';
  state.teacherResourceSearch = '';
  state.teacherResourceType = '';
  state.teacherResourceCreateType = 'pdf';
  state.teacherResourceSubjectId = '';
  state.teacherTestSubjectId = '';
  state.teacherTestType = 'mcq';
  state.teacherMcqQuestionCount = '';
  state.teacherMcqDurationMinutes = MCQ_DEFAULT_DURATION_MINUTES;
  state.teacherMcqCorrectMark = 1;
  state.teacherMcqWrongMark = 0;
  state.teacherPdfDurationMinutes = 60;
  state.teacherPdfPreview = null;
  state.teacherPdfPreviewBusy = false;
  state.teacherTestAudienceMode = 'all';
  state.teacherTestSelectedStudentIds = [];
  state.teacherTestScheduleEnabled = false;
  state.teacherTestScheduleDate = todayIsoDate();
  state.teacherTestScheduleStartTime = '17:00';
  state.teacherTestScheduleEndTime = '19:00';
  state.teacherViewedTestId = '';
  state.teacherReconductDraft = null;
  state.teacherAssessmentSubjectId = '';
  state.teacherAssessmentType = '';
  state.teacherAssessmentStatus = 'pending';
  state.teacherAssessmentQuery = '';
  state.studentResourceSearch = '';
  state.studentResourceType = '';
  state.studentResourceSubjectId = '';
  state.studentSyllabusSubjectId = '';
  state.studentPdfViewer = null;
  state.qaReports = {
    admin: null,
    teacher: null,
    student: null
  };
  state.qaRunningRole = '';
}

function clearAttemptTimer() {
  if (runtime.attemptTimerId) {
    clearInterval(runtime.attemptTimerId);
    runtime.attemptTimerId = null;
  }
  runtime.attemptSubmitting = false;
}

function clearApiCache() {
  runtime.apiCache.clear();
  runtime.apiInFlight.clear();
}

function cacheTtlForPath(path) {
  const key = String(path || '');
  if (key.includes('/health')) return 0;
  if (key.includes('/analytics')) return 8_000;
  if (key.includes('/summary')) return 7_000;
  if (key.includes('/subjects')) return 12_000;
  if (key.includes('/teachers')) return 8_000;
  if (key.includes('/students')) return 5_000;
  if (key.includes('/resources')) return 6_000;
  if (key.includes('/tests')) return 4_000;
  if (key.includes('/class-plans')) return 6_000;
  if (key.includes('/assessments')) return 4_000;
  if (key.includes('/auth/me')) return 10_000;
  return 5_000;
}

function beginNavTransition() {
  if (!app) return;
  app.classList.add('view-switching');
  if (runtime.navTransitionTimerId) clearTimeout(runtime.navTransitionTimerId);
  runtime.navTransitionTimerId = setTimeout(() => {
    app.classList.remove('view-switching');
  }, NAV_TRANSITION_MS);
}

function endNavTransition() {
  if (!app) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      app.classList.remove('view-switching');
    });
  });
}

function closeOpenNavDropdowns(except = null) {
  document.querySelectorAll('.nav-dropdown[open]').forEach((item) => {
    if (except && item === except) return;
    item.removeAttribute('open');
  });
}

function bindNavDropdowns() {
  const dropdowns = Array.from(document.querySelectorAll('.nav-dropdown'));
  if (!dropdowns.length) return;

  dropdowns.forEach((dropdown) => {
    const summary = dropdown.querySelector(':scope > summary');
    if (!summary) return;

    summary.addEventListener('click', (event) => {
      event.preventDefault();
      const wasOpen = dropdown.hasAttribute('open');
      closeOpenNavDropdowns(dropdown);
      if (wasOpen) {
        dropdown.removeAttribute('open');
      } else {
        dropdown.setAttribute('open', '');
      }
    });
  });

  if (!runtime.navOutsideClickBound) {
    document.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('.nav-dropdown')) return;
      closeOpenNavDropdowns();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeOpenNavDropdowns();
      }
    });

    runtime.navOutsideClickBound = true;
  }
}

function schedulePrefetch(paths = [], key = 'default', cooldownMs = 12_000) {
  if (!state.session?.user?.id) return;
  const now = Date.now();
  const previous = runtime.prefetchAt.get(key) || 0;
  if (now - previous < cooldownMs) return;
  runtime.prefetchAt.set(key, now);

  const cleanPaths = Array.from(
    new Set(
      paths
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  );
  if (!cleanPaths.length) return;

  const run = () => {
    cleanPaths.forEach((path) => {
      void api(path, { cacheTtlMs: 10_000 }).catch(() => {});
    });
  };

  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 1200 });
    return;
  }
  setTimeout(run, 120);
}

function debounceByKey(key, callback, delayMs = 180) {
  if (runtime.debounceHandles[key]) {
    clearTimeout(runtime.debounceHandles[key]);
  }
  runtime.debounceHandles[key] = setTimeout(() => {
    callback();
    delete runtime.debounceHandles[key];
  }, delayMs);
}

function ensureToastStack() {
  let stack = document.getElementById('toastStack');
  if (stack) return stack;
  stack = document.createElement('div');
  stack.id = 'toastStack';
  stack.className = 'toast-stack';
  document.body.appendChild(stack);
  return stack;
}

function showToast(message, type = 'info', timeoutMs = 2600) {
  const safe = String(message || '').trim();
  if (!safe) return;
  const stack = ensureToastStack();
  const toast = document.createElement('article');
  toast.className = `toast toast-${type}`;
  toast.textContent = safe;
  stack.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
      if (!stack.children.length) stack.remove();
    }, 220);
  }, timeoutMs);
}

function withButtonLoading(button, loadingText, action) {
  if (!button) return action();
  if (button.dataset.loading === '1') return Promise.resolve();

  const originalText = button.textContent;
  button.dataset.loading = '1';
  button.disabled = true;
  button.classList.add('is-loading');
  button.innerHTML = `<span class="btn-content"><span class="btn-spinner" aria-hidden="true"></span><span>${loadingText}</span></span>`;

  const finish = () => {
    button.dataset.loading = '0';
    button.disabled = false;
    button.classList.remove('is-loading');
    button.textContent = originalText;
  };

  return Promise.resolve()
    .then(() => action())
    .finally(finish);
}

function sanitizeValue(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

async function uploadAsset(file, folder = 'uploads') {
  if (!file) {
    throw new Error('File missing.');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', folder);

  const result = await api('/uploads', {
    method: 'POST',
    body: formData
  });

  const fileData = result?.data?.file;
  if (!fileData?.url) {
    throw new Error('Upload response is missing file URL.');
  }

  return fileData;
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

async function copyTextToClipboard(text) {
  const safeText = String(text || '');
  if (!safeText) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(safeText);
    return;
  }
  const area = document.createElement('textarea');
  area.value = safeText;
  area.setAttribute('readonly', 'readonly');
  area.style.position = 'absolute';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function logoMarkup(compact = false) {
  return '';
}

function roleLabel(role) {
  if (role === 'admin') return 'Admin';
  if (role === 'teacher') return 'Teacher';
  if (role === 'student') return 'Student';
  if (role === 'super_admin') return 'Owner';
  return role;
}

function cleanPhone(phone) {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  return digits.length === 10 ? `91${digits}` : digits;
}

function generateTempPassword() {
  const random = Math.random().toString(36).slice(2, 8);
  return `Lift@${random}`;
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return String(value);
  }
}

function formatTime(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (error) {
    return String(value);
  }
}

function formatTestWindow(test) {
  const start = test?.scheduledStartAt;
  const end = test?.scheduledEndAt;
  if (!start || !end) return 'Always available';
  return `${formatDate(start)} to ${formatTime(end)}`;
}

function combineDateAndTimeToIso(dateValue, timeValue) {
  const cleanDate = String(dateValue || '').trim();
  const cleanTime = String(timeValue || '').trim();
  if (!cleanDate || !cleanTime) return '';
  const localDate = new Date(`${cleanDate}T${cleanTime}:00`);
  if (Number.isNaN(localDate.getTime())) return '';
  return localDate.toISOString();
}

function formatTestType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'mcq') return 'MCQ';
  if (normalized === 'long') return 'UPLOAD QUESTIONS AS PDF';
  return normalized ? normalized.replace(/_/g, ' ').toUpperCase() : '-';
}

function toQueryString(params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    const clean = String(value).trim();
    if (!clean) return;
    search.set(key, clean);
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}

function resolveEntityId(entity) {
  if (!entity || typeof entity !== 'object') return '';
  const candidate = entity._id ?? entity.id ?? entity.userId ?? entity.subjectId;
  return candidate == null ? '' : String(candidate);
}

function resolveSubjectId(subject) {
  if (!subject) return '';
  if (typeof subject === 'string' || typeof subject === 'number') return String(subject);
  return resolveEntityId(subject);
}

function checkedDataValues(selector, attribute) {
  return Array.from(document.querySelectorAll(selector))
    .map((item) => item.getAttribute(attribute))
    .filter(Boolean);
}

const ROLE_SMOKE_CHECKS = {
  admin: [
    { label: 'Profile', path: '/auth/me' },
    { label: 'Summary', path: '/admin/summary' },
    { label: 'Courses', path: '/admin/subjects' },
    { label: 'Teachers', path: '/admin/teachers' },
    { label: 'Students', path: '/admin/students?limit=1' }
  ],
  teacher: [
    { label: 'Profile', path: '/auth/me' },
    { label: 'Subjects', path: '/teacher/subjects' },
    { label: 'Students', path: '/teacher/students?limit=1' },
    { label: 'Resources', path: '/teacher/resources?limit=1' },
    { label: 'Tests', path: '/teacher/tests?limit=1' }
  ],
  student: [
    { label: 'Profile', path: '/auth/me' },
    { label: 'Dashboard', path: '/student/dashboard' },
    { label: "Today's Queue", path: '/student/tests/queue' },
    { label: 'Resources', path: '/student/resources?limit=1' },
    { label: 'Syllabus', path: '/student/syllabus' }
  ]
};

async function runRoleSmokeChecks(role) {
  const checks = ROLE_SMOKE_CHECKS[role] || [];
  const startedAt = Date.now();

  const results = await Promise.all(
    checks.map(async (check) => {
      const checkStart = Date.now();
      try {
        await api(check.path, { cacheTtlMs: 0, noCache: true });
        return {
          ...check,
          ok: true,
          durationMs: Date.now() - checkStart,
          message: 'OK'
        };
      } catch (error) {
        return {
          ...check,
          ok: false,
          durationMs: Date.now() - checkStart,
          message: error.message || 'Failed'
        };
      }
    })
  );

  const passedCount = results.filter((item) => item.ok).length;
  return {
    role,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    passedCount,
    failedCount: results.length - passedCount,
    results
  };
}

function smokeReportMarkup(report) {
  if (!report) return '';

  return `
    <section class="panel smoke-panel">
      <div class="progress-row">
        <h3>Quick QA Check</h3>
        <span class="alert-tag ${
          report.failedCount ? 'alert-tag-warn' : 'alert-tag-ok'
        }">${escapeHtml(report.failedCount ? 'Needs Attention' : 'All Good')}</span>
      </div>
      <p class="muted">
        ${escapeHtml(report.passedCount)} passed, ${escapeHtml(report.failedCount)} failed in ${escapeHtml(
          report.durationMs
        )} ms
      </p>
      <div class="smoke-list">
        ${report.results
          .map(
            (item) => `
              <article class="smoke-item ${item.ok ? 'ok' : 'fail'}">
                <strong>${escapeHtml(item.label)}</strong>
                <span>${escapeHtml(item.durationMs)} ms</span>
                <p class="muted">${escapeHtml(item.message)}</p>
              </article>
            `
          )
          .join('')}
      </div>
    </section>
  `;
}

function adminNavMarkup(activeTab) {
  const isTeacherTab = String(activeTab || '').startsWith('teachers_');
  const isStudentTab = String(activeTab || '').startsWith('students_');
  const isCourseTab = String(activeTab || '').startsWith('courses_');

  return `
    <button class="nav-tab ${activeTab === 'dashboard' ? 'active' : ''}" data-admin-tab="dashboard">Dashboard</button>
    <button class="nav-tab ${activeTab === 'analytics' ? 'active' : ''}" data-admin-tab="analytics">Analytics</button>

    <details class="nav-dropdown ${isTeacherTab ? 'active' : ''}">
      <summary class="nav-tab ${isTeacherTab ? 'active' : ''}">Teachers</summary>
      <div class="nav-dropdown-menu">
        <button type="button" class="nav-dropdown-item ${activeTab === 'teachers_create' ? 'active' : ''}" data-admin-tab="teachers_create">Create New Teacher</button>
        <button type="button" class="nav-dropdown-item ${activeTab === 'teachers_edit' ? 'active' : ''}" data-admin-tab="teachers_edit">Edit Existing Teacher</button>
        <button type="button" class="nav-dropdown-item ${activeTab === 'teachers_reset' ? 'active' : ''}" data-admin-tab="teachers_reset">Create New Password</button>
        <button type="button" class="nav-dropdown-item ${activeTab === 'teachers_delete' ? 'active' : ''}" data-admin-tab="teachers_delete">Delete Teacher</button>
      </div>
    </details>

    <details class="nav-dropdown ${isStudentTab ? 'active' : ''}">
      <summary class="nav-tab ${isStudentTab ? 'active' : ''}">Students</summary>
      <div class="nav-dropdown-menu">
        <button type="button" class="nav-dropdown-item ${activeTab === 'students_view' ? 'active' : ''}" data-admin-tab="students_view">View Students</button>
      </div>
    </details>

    <details class="nav-dropdown ${isCourseTab ? 'active' : ''}">
      <summary class="nav-tab ${isCourseTab ? 'active' : ''}">Courses</summary>
      <div class="nav-dropdown-menu">
        <button type="button" class="nav-dropdown-item ${activeTab === 'courses_create' ? 'active' : ''}" data-admin-tab="courses_create">Create New Course</button>
        <button type="button" class="nav-dropdown-item ${activeTab === 'courses_edit' ? 'active' : ''}" data-admin-tab="courses_edit">Edit Course</button>
        <button type="button" class="nav-dropdown-item ${activeTab === 'courses_delete' ? 'active' : ''}" data-admin-tab="courses_delete">Delete Course</button>
      </div>
    </details>

    <button class="nav-tab ${activeTab === 'accounts' ? 'active' : ''}" data-admin-tab="accounts">Accounts</button>
  `;
}

function teacherNavMarkup(activeTab) {
  const isManagementTab = activeTab === 'subjects' || activeTab === 'students';
  const isAssessmentTab =
    activeTab === 'assessment_conduct' ||
    activeTab === 'assessment_results';

  return `
    <button class="nav-tab ${activeTab === 'dashboard' ? 'active' : ''}" data-teacher-tab="dashboard">Dashboard</button>

    <details class="nav-dropdown ${isManagementTab ? 'active' : ''}">
      <summary class="nav-tab ${isManagementTab ? 'active' : ''}">Management</summary>
      <div class="nav-dropdown-menu">
        <button type="button" class="nav-dropdown-item ${activeTab === 'subjects' ? 'active' : ''}" data-teacher-tab="subjects">Subjects</button>
        <button type="button" class="nav-dropdown-item ${activeTab === 'students' ? 'active' : ''}" data-teacher-tab="students">Students</button>
      </div>
    </details>

    <button class="nav-tab ${activeTab === 'class_planner' ? 'active' : ''}" data-teacher-tab="class_planner">Class Planner</button>
    <button class="nav-tab ${activeTab === 'resources' ? 'active' : ''}" data-teacher-tab="resources">Upload Resources</button>

    <details class="nav-dropdown ${isAssessmentTab ? 'active' : ''}">
      <summary class="nav-tab ${isAssessmentTab ? 'active' : ''}">Assessment</summary>
      <div class="nav-dropdown-menu">
        <button type="button" class="nav-dropdown-item ${activeTab === 'assessment_conduct' ? 'active' : ''}" data-teacher-tab="assessment_conduct">Conduct Test</button>
        <button type="button" class="nav-dropdown-item ${activeTab === 'assessment_results' ? 'active' : ''}" data-teacher-tab="assessment_results">Evaluate Results</button>
      </div>
    </details>

    <button class="nav-tab ${activeTab === 'accounts' ? 'active' : ''}" data-teacher-tab="accounts">Accounts</button>
  `;
}

function studentNavMarkup(activeTab) {
  const isTestsTab =
    activeTab === 'today' ||
    activeTab === 'pending' ||
    activeTab === 'history';
  const isLearningTab =
    activeTab === 'classes' ||
    activeTab === 'resources' ||
    activeTab === 'syllabus' ||
    activeTab === 'planner';

  return `
    <button class="nav-tab ${activeTab === 'dashboard' ? 'active' : ''}" data-student-tab="dashboard">Dashboard</button>

    <details class="nav-dropdown ${isTestsTab ? 'active' : ''}">
      <summary class="nav-tab ${isTestsTab ? 'active' : ''}">Tests</summary>
      <div class="nav-dropdown-menu">
        <button type="button" class="nav-dropdown-item ${activeTab === 'today' ? 'active' : ''}" data-student-tab="today">Today's Test</button>
        <button type="button" class="nav-dropdown-item ${activeTab === 'pending' ? 'active' : ''}" data-student-tab="pending">Pending Tests</button>
        <button type="button" class="nav-dropdown-item ${activeTab === 'history' ? 'active' : ''}" data-student-tab="history">Test History</button>
      </div>
    </details>

    <details class="nav-dropdown ${isLearningTab ? 'active' : ''}">
      <summary class="nav-tab ${isLearningTab ? 'active' : ''}">Learning</summary>
      <div class="nav-dropdown-menu">
        <button type="button" class="nav-dropdown-item ${activeTab === 'classes' ? 'active' : ''}" data-student-tab="classes">Today's Classes</button>
        <button type="button" class="nav-dropdown-item ${activeTab === 'resources' ? 'active' : ''}" data-student-tab="resources">Resources</button>
        <button type="button" class="nav-dropdown-item ${activeTab === 'syllabus' ? 'active' : ''}" data-student-tab="syllabus">Syllabus</button>
        <button type="button" class="nav-dropdown-item ${activeTab === 'planner' ? 'active' : ''}" data-student-tab="planner">Study To-Do</button>
      </div>
    </details>

    <button class="nav-tab ${activeTab === 'accounts' ? 'active' : ''}" data-student-tab="accounts">Accounts</button>
  `;
}

function getValidMcqQuestionCount(value) {
  const parsed = Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  if (normalized < MCQ_MIN_QUESTION_COUNT || normalized > MCQ_MAX_QUESTION_COUNT) return null;
  return normalized;
}

function objectiveQuestionBuilderMarkup(questionCount) {
  const safeCount = Math.max(
    MCQ_MIN_QUESTION_COUNT,
    Math.min(MCQ_MAX_QUESTION_COUNT, Number(questionCount || MCQ_DEFAULT_QUESTION_COUNT))
  );
  const cards = Array.from({ length: safeCount }, (_, index) => {
    const serial = index + 1;
    return `
      <article class="question-builder-card">
        <h4>Question ${serial}</h4>
        <input id="objective-q-${index}" type="text" placeholder="Enter question ${serial}" />
        <div class="builder-options">
          <input id="objective-q-${index}-opt-0" type="text" placeholder="Option A" />
          <input id="objective-q-${index}-opt-1" type="text" placeholder="Option B" />
          <input id="objective-q-${index}-opt-2" type="text" placeholder="Option C" />
          <input id="objective-q-${index}-opt-3" type="text" placeholder="Option D" />
        </div>
        <select id="objective-q-${index}-answer">
          <option value="0">Correct Option: A</option>
          <option value="1">Correct Option: B</option>
          <option value="2">Correct Option: C</option>
          <option value="3">Correct Option: D</option>
        </select>
      </article>
    `;
  }).join('');

  return `
    <section class="builder-box">
      <p class="muted">Use the boxes below to create all ${safeCount} questions.</p>
      <div class="objective-builder-grid">${cards}</div>
    </section>
  `;
}

function collectObjectiveQuestions(questionCount) {
  const safeCount = Math.max(
    MCQ_MIN_QUESTION_COUNT,
    Math.min(MCQ_MAX_QUESTION_COUNT, Number(questionCount || MCQ_DEFAULT_QUESTION_COUNT))
  );
  const questions = [];
  for (let index = 0; index < safeCount; index += 1) {
    const questionText = sanitizeValue(
      document.getElementById(`objective-q-${index}`)?.value || ''
    );
    if (!questionText) {
      throw new Error(`Question ${index + 1} text is required.`);
    }

    const options = [0, 1, 2, 3].map((optionIndex) =>
      sanitizeValue(document.getElementById(`objective-q-${index}-opt-${optionIndex}`)?.value || '')
    );
    if (options.some((option) => !option)) {
      throw new Error(`Question ${index + 1} must include all four options.`);
    }

    const correctIndex = Number(
      document.getElementById(`objective-q-${index}-answer`)?.value
    );
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      throw new Error(`Question ${index + 1} must have a valid correct option.`);
    }

    questions.push({
      text: questionText,
      options,
      correctIndex
    });
  }
  return questions;
}

function buildReconductDraftFromTest(test) {
  return {
    sourceTestId: String(test?._id || ''),
    subjectId: String(test?.subjectId || ''),
    title: String(test?.title || ''),
    durationMinutes: Number(test?.durationMinutes || MCQ_DEFAULT_DURATION_MINUTES),
    mcqCorrectMark: Number(test?.mcqCorrectMark ?? 1),
    mcqWrongMark: Number(test?.mcqWrongMark ?? 0),
    audienceMode: 'selected',
    selectedStudentIds: [],
    questions: (test?.questions || []).map((question) => ({
      text: String(question?.text || ''),
      options: Array.isArray(question?.options)
        ? question.options.map((option) => String(option || ''))
        : ['', '', '', ''],
      correctIndex: Number(question?.correctIndex ?? 0)
    }))
  };
}

function collectReconductQuestionsFromDom(questionCount) {
  const count = Math.max(1, Number(questionCount || 0));
  const questions = [];

  for (let index = 0; index < count; index += 1) {
    const text = sanitizeValue(document.getElementById(`reconduct-q-${index}`)?.value || '');
    if (!text) throw new Error(`Question ${index + 1} text is required.`);

    const options = [0, 1, 2, 3].map((opt) =>
      sanitizeValue(document.getElementById(`reconduct-q-${index}-opt-${opt}`)?.value || '')
    );
    if (options.some((option) => !option)) {
      throw new Error(`Question ${index + 1} must include all four options.`);
    }

    const correctIndex = Number(
      document.getElementById(`reconduct-q-${index}-answer`)?.value
    );
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      throw new Error(`Question ${index + 1} must have a valid correct option.`);
    }

    questions.push({
      text,
      options,
      correctIndex
    });
  }

  return questions;
}

function funnelCardMarkup(title, metrics) {
  if (!metrics) {
    return `
      <article class="panel stat">
        <h3>${escapeHtml(title)}</h3>
        <p>No analytics yet.</p>
      </article>
    `;
  }

  const steps = Array.isArray(metrics.steps) ? metrics.steps : [];
  return `
    <article class="panel">
      <h3>${escapeHtml(title)}</h3>
      <p class="muted">Activation: <strong>${escapeHtml(metrics.activationRate)}%</strong> | Drop-off: <strong>${escapeHtml(metrics.dropOffRate)}%</strong></p>
      <p class="muted">Retention (7d/30d): <strong>${escapeHtml(metrics.retention?.active7d || 0)}</strong> / <strong>${escapeHtml(metrics.retention?.active30d || 0)}</strong></p>
      <div class="stack">
        ${steps
          .map(
            (item) =>
              `<p class="stack-item"><strong>${escapeHtml(item.name)}:</strong> ${escapeHtml(item.count)} <small>(drop ${escapeHtml(item.dropOffFromPrevious)})</small></p>`
          )
          .join('')}
      </div>
    </article>
  `;
}

function downloadCsv(filename, columns, rows) {
  const head = columns.join(',');
  const body = rows
    .map((row) =>
      columns
        .map((column) => {
          const value = String(row[column] ?? '');
          if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        })
        .join(',')
    )
    .join('\n');

  const blob = new Blob([`${head}\n${body}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadTextFile(filename, content) {
  const blob = new Blob([String(content || '')], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getJsPdfClass() {
  return window.jspdf?.jsPDF || null;
}

function saveTextAsPdf(filename, lines = []) {
  const JsPdf = getJsPdfClass();
  if (!JsPdf) throw new Error('PDF export is not available right now. Refresh and try again.');

  const doc = new JsPdf({ unit: 'pt', format: 'a4' });
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 48;
  const marginY = 48;
  const maxWidth = doc.internal.pageSize.getWidth() - marginX * 2;
  const lineHeight = 16;
  let cursorY = marginY;

  const pushLine = (text = '') => {
    const segments = doc.splitTextToSize(String(text), maxWidth);
    segments.forEach((segment) => {
      if (cursorY > pageHeight - marginY) {
        doc.addPage();
        cursorY = marginY;
      }
      doc.text(segment, marginX, cursorY);
      cursorY += lineHeight;
    });
  };

  (lines || []).forEach((line) => pushLine(line));
  doc.save(filename);
}

function buildMcqQuestionsPdfLines(test) {
  const lines = [];
  lines.push(`Test: ${test.title || 'MCQ Test'}`);
  lines.push(`Type: MCQ`);
  lines.push(`Duration: ${test.durationMinutes || '-'} minutes`);
  lines.push(`Questions: ${(test.questions || []).length}`);
  lines.push('');

  (test.questions || []).forEach((question, index) => {
    lines.push(`${index + 1}. ${question.text || ''}`);
    const options = Array.isArray(question.options) ? question.options : [];
    options.forEach((option, optionIndex) => {
      lines.push(`   ${String.fromCharCode(65 + optionIndex)}. ${option}`);
    });
    lines.push('');
  });

  return lines;
}

function buildMcqAnswerKeyPdfLines(test) {
  const lines = [];
  lines.push(`Answer Key: ${test.title || 'MCQ Test'}`);
  lines.push('');

  (test.questions || []).forEach((question, index) => {
    const options = Array.isArray(question.options) ? question.options : [];
    const correctIndex = Number(question.correctIndex);
    const correctLetter =
      Number.isInteger(correctIndex) && correctIndex >= 0 && correctIndex < options.length
        ? String.fromCharCode(65 + correctIndex)
        : '-';
    const correctText =
      Number.isInteger(correctIndex) && correctIndex >= 0 && correctIndex < options.length
        ? options[correctIndex]
        : '';
    lines.push(`${index + 1}. ${correctLetter}${correctText ? ` - ${correctText}` : ''}`);
  });

  return lines;
}

function buildMcqCombinedPdfLines(test) {
  return [
    ...buildMcqQuestionsPdfLines(test),
    '',
    '----------------------------------------',
    'ANSWER KEY',
    '----------------------------------------',
    '',
    ...buildMcqAnswerKeyPdfLines(test)
  ];
}

async function extractQuestionsFromPdf(file, options = {}) {
  if (!file) throw new Error('Please upload a PDF file.');
  if (!window.pdfjsLib) throw new Error('PDF reader is not ready. Refresh and try again.');

  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const markerRegex = /^((q(uestion)?\s*)?\d+[\.\):\-]|q[\.\):\-]?\d+)\s*/i;
  const optionRegex = /^([a-h][\)\.\-:]|option\s*[a-h])/i;
  const answerRegex = /^(answer|correct answer|ans)[\s:\-]/i;

  const stripQuestionMarker = (line) => line.replace(markerRegex, '').trim() || line.trim();
  const stripOptionMarker = (line) =>
    line
      .replace(/^option\s*/i, '')
      .replace(/^[a-h][\)\.\-:]\s*/i, '')
      .trim();
  const extractInlineOptions = (rawText) => {
    const text = String(rawText || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;

    const matches = [...text.matchAll(/(?:^|\s)([A-H])[\)\.\-:]\s*/gi)];
    if (matches.length < 2) return null;

    const questionText = text.slice(0, matches[0].index).trim();
    if (!questionText) return null;

    const options = matches
      .map((match, index) => {
        const start = match.index + match[0].length;
        const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
        return text.slice(start, end).replace(/\s+/g, ' ').trim();
      })
      .filter(Boolean);

    if (options.length < 2) return null;
    return { questionText, options };
  };
  const buildQuestionFromBlock = (lines, index) => {
    const safeLines = lines
      .map((line) => String(line || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .filter((line) => !answerRegex.test(line));

    if (!safeLines.length) return null;

    let questionText = '';
    let options = [];

    const optionLines = safeLines.filter((line) => optionRegex.test(line));
    const contentLines = safeLines.filter((line) => !optionRegex.test(line));

    if (optionLines.length >= 2) {
      questionText = contentLines.join(' ').trim();
      options = optionLines.map(stripOptionMarker).filter(Boolean);
    }

    if (!options.length) {
      const inlineParsed = extractInlineOptions(safeLines.join(' '));
      if (inlineParsed) {
        questionText = inlineParsed.questionText;
        options = inlineParsed.options;
      } else {
        questionText = contentLines.join(' ').trim() || safeLines.join(' ').trim();
      }
    }

    questionText = questionText.replace(/\s+/g, ' ').trim();
    if (!questionText) return null;

    const normalizedQuestion = {
      text:
        questionText.length > 420
          ? `${questionText.slice(0, 417)}...`
          : questionText || `Question ${index + 1}`
    };

    if (options.length >= 2) {
      normalizedQuestion.options = options
        .map((option) => option.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 8);
    }

    return normalizedQuestion;
  };

  const normalizeQuestions = (rawLines) => {
    const filteredLines = (rawLines || [])
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length >= 3);

    if (!filteredLines.length) return [];

    const questionBlocks = [];
    let currentBlock = [];

    filteredLines.forEach((line) => {
      const isQuestionStart = markerRegex.test(line);
      const isOptionLine = optionRegex.test(line);

      if (isQuestionStart && !isOptionLine) {
        if (currentBlock.length) questionBlocks.push(currentBlock);
        currentBlock = [stripQuestionMarker(line)];
        return;
      }

      if (!currentBlock.length) {
        currentBlock = [line];
        return;
      }

      currentBlock.push(line);
    });

    if (currentBlock.length) questionBlocks.push(currentBlock);

    let normalized = questionBlocks
      .map((block, index) => buildQuestionFromBlock(block, index))
      .filter(Boolean);

    if (!normalized.length) {
      normalized = filteredLines
        .join('\n')
        .split(/\?/)
        .map((chunk) => chunk.replace(/\s+/g, ' ').trim())
        .filter((chunk) => chunk.length >= 3)
        .map((chunk, index) => ({
          text: `${chunk}?` || `Question ${index + 1}`
        }));
    }

    normalized = normalized.slice(0, 40);
    return normalized.map((question, index) => ({
      text: String(question?.text || '').trim() || `Question ${index + 1}`,
      ...(Array.isArray(question?.options) && question.options.length >= 2
        ? { options: question.options }
        : {})
    }));
  };

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const lines = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onStatus(`Reading PDF page ${pageNumber} of ${pdf.numPages}...`);
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const buckets = new Map();

    (textContent.items || []).forEach((item) => {
      const text = String(item.str || '').trim();
      if (!text) return;
      const y = Math.round(Number(item.transform?.[5] || 0));
      const key = Number.isFinite(y) ? y : 0;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(text);
    });

    const ordered = [...buckets.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, row]) => row.join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    lines.push(...ordered);
  }

  let questions = normalizeQuestions(lines);
  let usedOcr = false;

  if (!questions.length) {
    if (!window.Tesseract?.recognize) {
      throw new Error('No readable question text found in this PDF and OCR is unavailable.');
    }

    usedOcr = true;
    const ocrLines = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onStatus(`Scanned PDF detected. Running OCR on page ${pageNumber} of ${pdf.numPages}...`);
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) continue;

      await page.render({ canvasContext: context, viewport }).promise;
      const result = await window.Tesseract.recognize(canvas, 'eng', {
        logger: (message) => {
          if (message?.status === 'recognizing text' && Number.isFinite(message.progress)) {
            onStatus(`OCR page ${pageNumber}/${pdf.numPages}: ${Math.round(message.progress * 100)}%`);
          }
        }
      });

      const pageText = String(result?.data?.text || '');
      ocrLines.push(
        ...pageText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      );
    }

    questions = normalizeQuestions(ocrLines);
  }

  if (!questions.length) {
    throw new Error('Could not detect questions from this PDF. Try a clearer PDF or review with OCR.');
  }

  return {
    questions,
    usedOcr
  };
}

function getFileSignature(file) {
  if (!file) return '';
  return [file.name || '', file.size || 0, file.lastModified || 0].join('::');
}

function teacherPdfPreviewMarkup() {
  const preview = state.teacherPdfPreview;
  if (state.teacherPdfPreviewBusy) {
    return `
      <section class="pdf-preview-panel loading">
        <div class="progress-row">
          <h4>Teacher Preview</h4>
          <span class="preview-badge">Processing</span>
        </div>
        <p class="muted">${escapeHtml(preview?.status || 'Extracting questions from PDF...')}</p>
      </section>
    `;
  }

  if (!preview) {
    return `
      <section class="pdf-preview-panel empty">
        <div class="progress-row">
          <h4>Teacher Preview</h4>
          <span class="preview-badge">Waiting</span>
        </div>
        <p class="muted">Upload a question PDF and preview the extracted exam before you publish it.</p>
      </section>
    `;
  }

  if (preview.error) {
    return `
      <section class="pdf-preview-panel error">
        <div class="progress-row">
          <h4>Teacher Preview</h4>
          <span class="preview-badge">Needs Review</span>
        </div>
        <p class="muted">${escapeHtml(preview.error)}</p>
      </section>
    `;
  }

  const questions = Array.isArray(preview.questions) ? preview.questions : [];
  return `
    <section class="pdf-preview-panel">
      <div class="progress-row">
        <h4>Teacher Preview</h4>
        <span class="preview-badge">${preview.usedOcr ? 'OCR Fallback' : 'Direct PDF Text'}</span>
      </div>
      <p class="muted">
        ${escapeHtml(questions.length)} question(s) detected. This is what students will see inside the exam screen.
        ${preview.usedOcr ? ' OCR was used because the PDF looks scanned, so review the wording carefully.' : ''}
      </p>
      <div class="preview-question-list">
        ${questions
          .map(
            (question, index) => `
              <article class="preview-question-card">
                <p><strong>Q${index + 1}.</strong> ${escapeHtml(question.text || '')}</p>
                ${
                  Array.isArray(question.options) && question.options.length
                    ? `
                      <div class="preview-option-list">
                        ${question.options
                          .map(
                            (option, optionIndex) => `
                              <span class="preview-option-chip">
                                ${String.fromCharCode(65 + optionIndex)}. ${escapeHtml(option)}
                              </span>
                            `
                          )
                          .join('')}
                      </div>
                    `
                    : '<p class="muted">Students will answer this question in a text box.</p>'
                }
              </article>
            `
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderTeacherPdfPreview() {
  const root = document.getElementById('teacherPdfPreviewRoot');
  if (!root) return;
  root.innerHTML = teacherPdfPreviewMarkup();
}

async function refreshTeacherPdfPreview(force = false) {
  const questionPdfInput = document.getElementById('testPdfQuestionsFile');
  const questionPdfFile = questionPdfInput?.files?.[0];

  if (!questionPdfFile) {
    state.teacherPdfPreview = null;
    state.teacherPdfPreviewBusy = false;
    renderTeacherPdfPreview();
    return null;
  }

  const fileSignature = getFileSignature(questionPdfFile);
  if (
    !force &&
    state.teacherPdfPreview &&
    !state.teacherPdfPreview.error &&
    state.teacherPdfPreview.fileSignature === fileSignature &&
    Array.isArray(state.teacherPdfPreview.questions) &&
    state.teacherPdfPreview.questions.length
  ) {
    renderTeacherPdfPreview();
    return state.teacherPdfPreview;
  }

  state.teacherPdfPreviewBusy = true;
  state.teacherPdfPreview = {
    fileSignature,
    status: 'Reading PDF...'
  };
  renderTeacherPdfPreview();

  try {
    const result = await extractQuestionsFromPdf(questionPdfFile, {
      onStatus(message) {
        state.teacherPdfPreview = {
          ...(state.teacherPdfPreview || {}),
          fileSignature,
          status: message
        };
        renderTeacherPdfPreview();
      }
    });

    state.teacherPdfPreviewBusy = false;
    state.teacherPdfPreview = {
      fileSignature,
      status: 'Preview ready.',
      questions: result.questions,
      usedOcr: Boolean(result.usedOcr)
    };
    renderTeacherPdfPreview();
    return state.teacherPdfPreview;
  } catch (error) {
    state.teacherPdfPreviewBusy = false;
    state.teacherPdfPreview = {
      fileSignature,
      error: error.message || 'Could not extract questions from this PDF.'
    };
    renderTeacherPdfPreview();
    throw error;
  }
}

function clearTeacherPdfPreview() {
  state.teacherPdfPreview = null;
  state.teacherPdfPreviewBusy = false;
  renderTeacherPdfPreview();
}

function assessmentAnswersMarkup(attempt) {
  const answers = Array.isArray(attempt?.answers) ? attempt.answers : [];
  if (!answers.length) return '<span class="muted">-</span>';

  if (attempt.type !== 'long') {
    return '<span class="muted">Auto-graded</span>';
  }

  return `
    <details class="assessment-details">
      <summary>View answers (${answers.length})</summary>
      <div class="assessment-answer-list">
        ${answers
          .map(
            (item, index) => `
              <article class="assessment-answer-item">
                <p><strong>Q${index + 1}:</strong> ${escapeHtml(item.questionText || '')}</p>
                <p class="muted"><strong>Answer:</strong> ${escapeHtml(item.answerText || item.selectedOption || '(No answer)')}</p>
              </article>
            `
          )
          .join('')}
      </div>
    </details>
  `;
}


async function resolveApiBase() {
  if (state.apiResolved) return state.apiBase;

  const hostname = String(window.location.hostname || '').toLowerCase();
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';

  if (!isLocalHost) {
    try {
      const sameOriginBase = `${window.location.origin}/api`;
      const response = await fetch(`${sameOriginBase}/health`, { method: 'GET' });
      if (response.ok || response.status === 401 || response.status === 403) {
        state.apiBase = sameOriginBase;
        state.apiResolved = true;
        return state.apiBase;
      }
    } catch (error) {
      // fallback below
    }
  }

  for (const port of API_CANDIDATE_PORTS) {
    const candidate = `http://127.0.0.1:${port}/api`;
    try {
      const response = await fetch(`${candidate}/health`, { method: 'GET' });
      if (!response.ok) continue;
      state.apiBase = candidate;
      state.apiResolved = true;
      return state.apiBase;
    } catch (error) {
      continue;
    }
  }

  state.apiBase = `${window.location.origin}/api`;
  state.apiResolved = true;
  return state.apiBase;
}

async function api(path, options = {}) {
  const base = await resolveApiBase();
  const method = String(options.method || 'GET').toUpperCase();
  const isCacheableGet =
    method === 'GET' && !options.body && !options.noCache && !options.headers?.['Cache-Control'];
  const tokenKey = state.session?.user?.id || state.session?.institutionId || 'anon';
  const cacheKey = `${tokenKey}:${path}`;
  const ttlMs = Math.max(0, Number(options.cacheTtlMs ?? cacheTtlForPath(path)));

  if (isCacheableGet) {
    const cached = runtime.apiCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.payload;
    }

    const inflight = runtime.apiInFlight.get(cacheKey);
    if (inflight) {
      return inflight;
    }
  }

  const headers = {
    ...(options.headers || {})
  };

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  if (state.session?.token) {
    headers.Authorization = `Bearer ${state.session.token}`;
  }

  const requestPromise = (async () => {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers,
      credentials: 'include'
    });

    let payload = null;
    const contentType = String(response.headers.get('content-type') || '');
    if (contentType.includes('application/json')) {
      try {
        payload = await response.json();
      } catch (error) {
        payload = { success: false, message: 'Invalid server response.' };
      }
    } else {
      const text = await response.text();
      if (/Authentication Required|Vercel Authentication/i.test(text)) {
        payload = {
          success: false,
          message:
            'This preview deployment is protected by Vercel login. Use the production URL or disable preview protection.'
        };
      } else {
        payload = { success: false, message: 'Invalid server response.' };
      }
    }

    if (!response.ok || payload.success === false) {
      throw new Error(payload.message || 'Request failed');
    }

    if (method !== 'GET') {
      clearApiCache();
    }

    return payload;
  })();

  if (isCacheableGet) {
    runtime.apiInFlight.set(cacheKey, requestPromise);
  }

  try {
    const payload = await requestPromise;
    if (isCacheableGet && ttlMs > 0) {
      runtime.apiCache.set(cacheKey, {
        payload,
        expiresAt: Date.now() + ttlMs
      });
    }
    return payload;
  } finally {
    if (isCacheableGet) {
      runtime.apiInFlight.delete(cacheKey);
    }
  }
}

async function logout() {
  clearAttemptTimer();
  try {
    await api('/auth/logout', {
      method: 'POST',
      noCache: true
    });
  } catch (error) {
    // Clear local session state even if the server cookie is already gone.
  }
  saveSession(null);
  resetUiStateOnLogout();
  renderWelcome();
}

async function fetchMe() {
  const result = await api('/auth/me');
  return result.data;
}

function accountSectionMarkup(user) {
  return `
    <section class="panel">
      <h3>Account Settings</h3>
      <p class="muted">Signed in as ${escapeHtml(user.fullName)} (${escapeHtml(user.username)})</p>

      <form id="changePasswordForm" class="account-form">
        <label for="currentPassword">Current Password</label>
        <input id="currentPassword" type="password" minlength="6" required />

        <label for="newPassword">New Password</label>
        <input id="newPassword" type="password" minlength="6" required />

        <button type="submit" class="cta-main">Change Password</button>
      </form>
      <p class="auth-note" id="changePasswordStatus"></p>
    </section>
  `;
}

function bindAccountPasswordForm() {
  const form = document.getElementById('changePasswordForm');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.getElementById('changePasswordStatus');
    const submitBtn = form.querySelector('button[type="submit"]');
    status.textContent = 'Updating password...';

    await withButtonLoading(submitBtn, 'Updating...', async () => {
      try {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;

        await api('/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newPassword })
        });

        status.textContent = 'Password changed successfully.';
        showToast('Password updated successfully.', 'success');
        form.reset();
      } catch (error) {
        status.textContent = error.message;
        showToast(error.message, 'error');
      }
    });
  });
}

function renderWelcome() {
  clearAttemptTimer();
  beginNavTransition();

  app.innerHTML = `
    <section class="welcome-page live-welcome">
      <div class="hero-overlay"></div>
      <div class="hero-content">
        <header class="hero-header">${logoMarkup()}</header>

        <h1 class="hero-title">
          Learn Smarter,<br />
          <span>Achieve More</span>
        </h1>

        <p class="hero-tagline">Your all-in-one platform for daily tests, study guides and seamless teacher-student collaboration</p>

        <div class="hero-actions">
          <button class="hero-btn admin" id="adminSignInBtn">I'm an Admin</button>
          <button class="hero-btn teacher" id="teacherSignInBtn">I'm a Teacher</button>
          <button class="hero-btn student" id="studentSignInBtn">I'm a Student</button>
        </div>
      </div>

      <footer class="hero-footer">Developed by LIFT Educations</footer>
    </section>
  `;

  document.getElementById('studentSignInBtn').addEventListener('click', () => renderLogin('student'));
  document.getElementById('teacherSignInBtn').addEventListener('click', () => renderLogin('teacher'));
  document.getElementById('adminSignInBtn').addEventListener('click', () => renderLogin('admin'));
  endNavTransition();
}

function renderLogin(role) {
  clearAttemptTimer();
  beginNavTransition();
  const loginHint = getLoginHint(role);

  const titleMap = {
    admin: 'Institution Admin Sign In',
    teacher: 'Teacher Sign In',
    student: 'Student Sign In'
  };

  app.innerHTML = `
    <section class="welcome-page live-welcome">
      <div class="hero-overlay"></div>
      <div class="hero-content">
        <header class="hero-header">${logoMarkup()}</header>

        <div class="auth-card live-auth-card">
          <h2 class="auth-title">${titleMap[role]}</h2>
          <p class="auth-subtitle">Use Institution ID, username and password.</p>

          <form id="loginForm" class="auth-form">
            <label for="institutionId">Institution ID</label>
            <input id="institutionId" type="text" value="${escapeHtml(loginHint.institutionId)}" required />

            <label for="username">Username</label>
            <input id="username" type="text" value="${escapeHtml(loginHint.username)}" required />

            <label for="password">Password</label>
            <input id="password" type="password" required />

            <label class="remember-row" for="rememberMe">
              <input id="rememberMe" type="checkbox" ${state.authRememberMe ? 'checked' : ''} />
              Remember me on this browser
            </label>

            <button type="submit" class="cta-main auth-submit">Sign In</button>
            <button type="button" class="back-link-btn" id="backBtn">Back</button>
          </form>

          <p class="auth-note" id="loginStatus"></p>
        </div>
      </div>
      <footer class="hero-footer">Developed by LIFT Educations</footer>
    </section>
  `;

  document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.getElementById('loginStatus');
    const submitBtn = document.querySelector('#loginForm button[type="submit"]');
    status.textContent = 'Signing in...';

    await withButtonLoading(submitBtn, 'Signing In...', async () => {
      try {
        const institutionId = document.getElementById('institutionId').value.trim();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const rememberLogin = document.getElementById('rememberMe')?.checked ?? true;

        const result = await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ institutionId, username, password, rememberMe: rememberLogin })
        });

        if (result.data.user.role !== role) {
          status.textContent = `This account is ${roleLabel(result.data.user.role)}. Use correct login.`;
          showToast(status.textContent, 'error');
          return;
        }

        saveSession({
          user: result.data.user,
          institutionId
        }, rememberLogin);
        updateLoginHint(role, institutionId, username, rememberLogin);

        showToast('Signed in successfully.', 'success', 1800);
        await renderByRole();
      } catch (error) {
        status.textContent = error.message;
        showToast(error.message, 'error');
      }
    });
  });

  document.getElementById('backBtn').addEventListener('click', renderWelcome);
  endNavTransition();
}

async function renderAdminDashboard() {
  clearAttemptTimer();
  beginNavTransition();

  if (state.adminTab === 'teachers') state.adminTab = 'teachers_create';
  if (state.adminTab === 'subjects') state.adminTab = 'courses_create';
  if (state.adminTab === 'students') state.adminTab = 'students_view';

  const allowedTabs = new Set([
    'dashboard',
    'analytics',
    'teachers_create',
    'teachers_edit',
    'teachers_reset',
    'teachers_delete',
    'students_view',
    'courses_create',
    'courses_edit',
    'courses_delete',
    'accounts'
  ]);
  if (!allowedTabs.has(state.adminTab)) {
    state.adminTab = 'dashboard';
  }

  const user = state.session?.user || { fullName: '', username: '' };
  const institutionId = state.session?.institutionId || '';
  const teacherMode = state.adminTab.startsWith('teachers_')
    ? state.adminTab.replace('teachers_', '')
    : '';
  const courseMode = state.adminTab.startsWith('courses_')
    ? state.adminTab.replace('courses_', '')
    : '';

  const shouldLoadSummary = state.adminTab === 'dashboard';
  const shouldLoadTeachers = Boolean(teacherMode);
  const shouldLoadSubjects = state.adminTab === 'students_view' || Boolean(courseMode);

  const studentsQuery = toQueryString({
    q: state.adminStudentQuery,
    subjectId: state.adminSubjectFilter
  });

  const [summaryResult, teachersResult, subjectsResult, studentsResult, analyticsResult] =
    await Promise.all([
      shouldLoadSummary
        ? api('/admin/summary')
        : Promise.resolve({ data: { summary: { teacherCount: 0, studentCount: 0, subjectCount: 0 } } }),
      shouldLoadTeachers ? api('/admin/teachers') : Promise.resolve({ data: { teachers: [] } }),
      shouldLoadSubjects ? api('/admin/subjects') : Promise.resolve({ data: { subjects: [] } }),
    state.adminTab === 'students_view' ? api(`/admin/students${studentsQuery}`) : Promise.resolve(null),
    state.adminTab === 'analytics'
      ? api(`/admin/analytics${toQueryString({ days: state.adminAnalyticsWindow })}`)
      : Promise.resolve(null)
    ]);

  const summary = summaryResult.data.summary;
  const teachers = teachersResult.data.teachers || [];
  const students = studentsResult?.data?.students || [];
  const subjects = subjectsResult.data.subjects || [];
  const analytics = analyticsResult?.data?.analytics || null;

  schedulePrefetch(
    ['/admin/summary', '/admin/teachers', '/admin/subjects', '/admin/students'],
    'admin-core'
  );

  teachers.forEach((teacher) => {
    if (teacher?.username && teacher?.temporaryPassword) {
      state.adminTeacherSecrets[teacher.username] = teacher.temporaryPassword;
    }
  });

  const getTeacherTempPassword = (teacher) =>
    state.adminTeacherSecrets[teacher?.username || ''] || teacher?.temporaryPassword || '';

  app.innerHTML = `
    <div class="dashboard-shell">
      <header class="main-nav">
        <div class="left-nav">
          ${logoMarkup(true)}
          ${adminNavMarkup(state.adminTab)}
        </div>
        <div class="top-actions">
          <button class="signout" id="logoutBtn">Sign Out</button>
        </div>
      </header>

      <main class="page container-xl">
        <h2>Welcome, ${escapeHtml(user.fullName)} 👋</h2>
        <p class="subline">Institution ID: ${escapeHtml(institutionId)}</p>
        ${smokeReportMarkup(state.qaReports.admin)}

        ${
          state.adminTab === 'dashboard'
            ? `
              <section class="stats-grid">
                <article class="panel stat"><h3>${summary.teacherCount}</h3><p>Total Teachers</p></article>
                <article class="panel stat"><h3>${summary.studentCount}</h3><p>Total Students</p></article>
                <article class="panel stat"><h3>${summary.subjectCount}</h3><p>Total Courses</p></article>
                <article class="panel stat"><h3>${summary.teacherCount ? Math.round((summary.studentCount / summary.teacherCount) * 10) / 10 : 0}</h3><p>Students / Teacher</p></article>
              </section>
            `
            : ''
        }

        ${
          state.adminTab === 'analytics'
            ? `
              <section class="panel">
                <div class="progress-row">
                  <h3>Role Funnel Analytics</h3>
                  <select id="adminAnalyticsWindow">
                    <option value="7" ${state.adminAnalyticsWindow === '7' ? 'selected' : ''}>7 days</option>
                    <option value="30" ${state.adminAnalyticsWindow === '30' ? 'selected' : ''}>30 days</option>
                    <option value="90" ${state.adminAnalyticsWindow === '90' ? 'selected' : ''}>90 days</option>
                  </select>
                </div>
                <p class="muted">Track activation, retention and drop-off by role.</p>
              </section>

              <section class="stats-grid">
                ${funnelCardMarkup('Admin', analytics?.roleFunnels?.admin)}
                ${funnelCardMarkup('Teacher', analytics?.roleFunnels?.teacher)}
                ${funnelCardMarkup('Student', analytics?.roleFunnels?.student)}
              </section>

              <section class="panel">
                <h3>Top Activity Events</h3>
                <div class="stack">
                  ${
                    (analytics?.eventsByType || []).length
                      ? (analytics?.eventsByType || [])
                          .slice(0, 10)
                          .map(
                            (item) =>
                              `<p class="stack-item"><strong>${escapeHtml(item.eventType)}:</strong> ${escapeHtml(item.count)}</p>`
                          )
                          .join('')
                      : '<p class="muted">No events found for this period.</p>'
                  }
                </div>
              </section>
            `
            : ''
        }

        ${
          teacherMode === 'create'
            ? `
              <section class="panel">
                <h3>Create Teacher</h3>
                <form id="createTeacherForm" class="two-grid-form">
                  <div>
                    <label for="teacherFullName">Full Name</label>
                    <input id="teacherFullName" type="text" required />
                  </div>
                  <div>
                    <label for="teacherUsername">Username</label>
                    <input id="teacherUsername" type="text" required />
                  </div>
                  <div>
                    <label for="teacherPassword">Temporary Password</label>
                    <input id="teacherPassword" type="text" minlength="6" required />
                  </div>
                  <div>
                    <label for="teacherEmail">Email</label>
                    <input id="teacherEmail" type="email" />
                  </div>
                  <div>
                    <label for="teacherPhone">Phone</label>
                    <input id="teacherPhone" type="text" />
                  </div>
                </form>
                <button id="createTeacherBtn" class="cta-main">Create Teacher Account</button>
                <p class="auth-note" id="createTeacherStatus"></p>
              </section>
            `
            : ''
        }

        ${
          teacherMode && teacherMode !== 'create'
            ? `
              <section class="panel table-panel">
                <h3>${
                  teacherMode === 'edit'
                    ? 'Edit Existing Teacher'
                    : teacherMode === 'reset'
                      ? 'Create New Password for Teacher'
                      : 'Delete Teacher'
                }</h3>
                <p class="muted">Share credentials by WhatsApp and export all temporary passwords to CSV. If an older teacher has no temporary password, use Reset Temp.</p>
                <button id="exportTeacherCredsCsvBtn" class="cta-soft">Export Teacher Credentials CSV</button>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Username</th>
                        <th>Temp Password</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Share</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        teachers.length
                          ? teachers
                              .map(
                                (teacher) => {
                                  const tempPassword = getTeacherTempPassword(teacher);
                                  const shareMessage = encodeURIComponent(
                                    `LIFT Educations login\nInstitution ID: ${state.session.institutionId}\nUsername: ${teacher.username}\nTemporary Password: ${tempPassword}`
                                  );
                                  const whatsPhone = cleanPhone(teacher.phone);
                                  const whatsUrl = whatsPhone
                                    ? `https://wa.me/${whatsPhone}?text=${shareMessage}`
                                    : `https://wa.me/?text=${shareMessage}`;

                                  return `
                                  <tr>
                                    <td>${escapeHtml(teacher.fullName)}</td>
                                    <td>${escapeHtml(teacher.username)}</td>
                                    <td>${tempPassword ? escapeHtml(tempPassword) : '<span class="muted">not available</span>'}</td>
                                    <td>${escapeHtml(teacher.email || '-')}</td>
                                    <td>${escapeHtml(teacher.phone || '-')}</td>
                                    <td>
                                      ${
                                        tempPassword
                                          ? `<a href="${whatsUrl}" target="_blank" rel="noreferrer">WhatsApp</a>`
                                          : '-'
                                      }
                                      ${
                                        tempPassword
                                          ? ` | <button class="mini-btn" data-copy-teacher-creds="${teacher.username}">Copy</button>`
                                          : ''
                                      }
                                    </td>
                                    <td>
                                      ${
                                        teacherMode === 'edit'
                                          ? `<button class="mini-btn" data-edit-teacher="${teacher._id}">Edit</button>`
                                          : ''
                                      }
                                      ${
                                        teacherMode === 'reset'
                                          ? `<button class="mini-btn" data-reset-teacher-password="${teacher._id}" data-reset-teacher-username="${escapeHtml(teacher.username)}">Reset Temp</button>`
                                          : ''
                                      }
                                      ${
                                        teacherMode === 'delete'
                                          ? `<button class="mini-btn danger" data-delete-teacher="${teacher._id}">Delete</button>`
                                          : ''
                                      }
                                    </td>
                                  </tr>
                                `;
                                }
                              )
                              .join('')
                          : '<tr><td colspan="7">No teachers yet.</td></tr>'
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            `
            : ''
        }

        ${
          courseMode === 'create'
            ? `
              <section class="panel">
                <h3>Create New Course (Uniform for All Teachers)</h3>
                <form id="adminCreateCourseForm" class="two-grid-form">
                  <div>
                    <label for="adminCourseName">Course Name</label>
                    <input id="adminCourseName" type="text" required />
                  </div>
                  <div>
                    <label for="adminCourseDuration">Course Duration</label>
                    <input id="adminCourseDuration" type="text" placeholder="e.g. 6 months or 1 year" required />
                  </div>
                  <div>
                    <label for="adminCourseSyllabusPdfFile">Syllabus PDF File</label>
                    <input id="adminCourseSyllabusPdfFile" type="file" accept=".pdf,application/pdf" required />
                  </div>
                </form>
                <button id="adminCreateCourseBtn" class="cta-main">Create Course</button>
                <p class="auth-note" id="adminCreateCourseStatus"></p>
              </section>
            `
            : ''
        }

        ${
          courseMode === 'edit' || courseMode === 'delete'
            ? `
              <section class="panel table-panel">
                <h3>${
                  courseMode === 'edit' ? 'Edit Course & Syllabus Manager' : 'Delete Course'
                }</h3>
                <p class="muted">Teachers will use these courses while creating students, resources, class plans and tests.</p>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Course</th>
                        <th>Duration</th>
                        <th>Syllabus</th>
                        <th>Last Updated</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        subjects.length
                          ? subjects
                              .map(
                                (subject) => `
                                  <tr>
                                    <td>${escapeHtml(subject.name)}</td>
                                    <td>${escapeHtml(subject.courseDuration || '-')}</td>
                                    <td>${
                                      subject.syllabusPdfUrl
                                        ? `<a href="${escapeHtml(subject.syllabusPdfUrl)}" target="_blank" rel="noreferrer">Open Syllabus</a>`
                                        : '-'
                                    }</td>
                                    <td>${formatDate(subject.updatedAt || subject.createdAt)}</td>
                                    <td>
                                      ${
                                        courseMode === 'edit'
                                          ? `<button class="mini-btn" data-admin-edit-course="${subject._id}">Edit Course</button>
                                             <button class="mini-btn" data-admin-update-syllabus="${subject._id}">Upload New Syllabus</button>`
                                          : ''
                                      }
                                      ${
                                        courseMode === 'delete'
                                          ? `<button class="mini-btn danger" data-admin-delete-course="${subject._id}">Delete</button>`
                                          : ''
                                      }
                                    </td>
                                  </tr>
                                `
                              )
                              .join('')
                          : '<tr><td colspan="5">No courses yet.</td></tr>'
                      }
                    </tbody>
                  </table>
                </div>
                <input id="adminUpdateSyllabusFileInput" type="file" accept=".pdf,application/pdf" hidden />
                <p class="auth-note" id="adminUpdateSyllabusStatus"></p>
              </section>
            `
            : ''
        }

        ${
          state.adminTab === 'students_view'
            ? `
              <section class="panel">
                <h3>Students</h3>
                <div class="two-grid-form">
                  <div>
                    <label for="adminStudentSearch">Search by Name</label>
                    <input id="adminStudentSearch" type="text" value="${escapeHtml(state.adminStudentQuery)}" placeholder="Type student name" />
                  </div>
                  <div>
                    <label for="adminSubjectFilter">Filter by Course</label>
                    <select id="adminSubjectFilter">
                      <option value="">All Courses</option>
                      ${subjects
                        .map(
                          (subject) =>
                            `<option value="${subject._id}" ${
                              state.adminSubjectFilter === subject._id ? 'selected' : ''
                            }>${escapeHtml(subject.name)}</option>`
                        )
                        .join('')}
                    </select>
                  </div>
                </div>
              </section>

              <section class="panel table-panel">
                <h3>Live Test Monitor</h3>
                <p class="muted">Track ongoing tests and attendance in real time.</p>
                ${
                  liveTestStats.length
                    ? liveTestStats
                        .map(
                          (liveTest) => `
                            <article class="stack-item">
                              <div class="progress-row">
                                <div>
                                  <p><strong>${escapeHtml(liveTest.title)}</strong></p>
                                  <p class="muted">${escapeHtml(liveTest.subjectName || '-')} | ${escapeHtml(formatTestType(liveTest.type))} | Ends in ${escapeHtml(liveTest.remainingMinutes)} min</p>
                                </div>
                                <div>
                                  <span class="alert-tag">${escapeHtml(liveTest.attendedCount)} attended</span>
                                  <span class="alert-tag alert-tag-warn">${escapeHtml(liveTest.pendingCount)} pending</span>
                                </div>
                              </div>
                              <div class="table-wrap">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Student</th>
                                      <th>Username</th>
                                      <th>Status</th>
                                      <th>Submitted At</th>
                                      <th>Score</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    ${
                                      (liveTest.students || []).length
                                        ? liveTest.students
                                            .map(
                                              (row) => `
                                                <tr>
                                                  <td>${escapeHtml(row.fullName || '-')}</td>
                                                  <td>${escapeHtml(row.username || '-')}</td>
                                                  <td>${row.attended ? '<span class="status-badge done">Attended</span>' : '<span class="status-badge pending">Pending</span>'}</td>
                                                  <td>${row.submittedAt ? escapeHtml(formatDate(row.submittedAt)) : '-'}</td>
                                                  <td>${row.scorePercent == null ? '-' : `${escapeHtml(row.scorePercent)}%`}</td>
                                                </tr>
                                              `
                                            )
                                            .join('')
                                        : '<tr><td colspan="5">No students assigned.</td></tr>'
                                    }
                                  </tbody>
                                </table>
                              </div>
                            </article>
                          `
                        )
                        .join('')
                    : '<p class="muted">No live tests are running right now.</p>'
                }
              </section>

              <section class="panel table-panel">
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Username</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Courses</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        students.length
                          ? students
                              .map(
                                (student) => `
                                  <tr>
                                    <td>${escapeHtml(student.fullName)}</td>
                                    <td>${escapeHtml(student.username)}</td>
                                    <td>${escapeHtml(student.email || '-')}</td>
                                    <td>${escapeHtml(student.phone || '-')}</td>
                                    <td>${escapeHtml((student.subjects || []).map((item) => item.name).filter(Boolean).join(', ') || '-')}</td>
                                  </tr>
                                `
                              )
                              .join('')
                          : '<tr><td colspan="5">No matching students.</td></tr>'
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            `
            : ''
        }

        ${state.adminTab === 'accounts' ? accountSectionMarkup(user) : ''}
        <button class="cta-soft mini-qa-btn floating-qa-btn" id="runQaBtn">Run QA Check</button>
      </main>
    </div>
  `;

  document.querySelectorAll('[data-admin-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.adminTab = button.getAttribute('data-admin-tab') || 'dashboard';
      closeOpenNavDropdowns();
      void renderAdminDashboard();
    });
  });
  bindNavDropdowns();

  document.getElementById('logoutBtn').addEventListener('click', logout);

  const runQaBtn = document.getElementById('runQaBtn');
  if (runQaBtn) {
    runQaBtn.addEventListener('click', async () => {
      if (state.qaRunningRole === 'admin') return;
      state.qaRunningRole = 'admin';
      await withButtonLoading(runQaBtn, 'Checking...', async () => {
        const report = await runRoleSmokeChecks('admin');
        state.qaReports.admin = report;
        if (report.failedCount > 0) {
          showToast(`QA finished: ${report.failedCount} check(s) failed.`, 'error', 3200);
        } else {
          showToast('QA finished: all checks passed.', 'success', 2200);
        }
      });
      state.qaRunningRole = '';
      await renderAdminDashboard();
    });
  }

  const analyticsWindow = document.getElementById('adminAnalyticsWindow');
  if (analyticsWindow) {
    analyticsWindow.addEventListener('change', (event) => {
      state.adminAnalyticsWindow = event.target.value || '30';
      void renderAdminDashboard();
    });
  }

  const createTeacherBtn = document.getElementById('createTeacherBtn');
  if (createTeacherBtn) {
    createTeacherBtn.addEventListener('click', async () => {
      const status = document.getElementById('createTeacherStatus');
      const form = document.getElementById('createTeacherForm');
      if (form && !form.reportValidity()) return;
      status.textContent = 'Creating teacher...';

      await withButtonLoading(createTeacherBtn, 'Creating...', async () => {
        try {
          const fullName = document.getElementById('teacherFullName').value.trim();
          const username = document.getElementById('teacherUsername').value.trim();
          const password = document.getElementById('teacherPassword').value;
          const email = document.getElementById('teacherEmail').value.trim();
          const phone = document.getElementById('teacherPhone').value.trim();

          if (fullName.length < 2) {
            status.textContent = 'Full name must be at least 2 characters.';
            showToast(status.textContent, 'error');
            return;
          }
          if (username.length < 3) {
            status.textContent = 'Username must be at least 3 characters.';
            showToast(status.textContent, 'error');
            return;
          }
          if (password.length < 6) {
            status.textContent = 'Password must be at least 6 characters.';
            showToast(status.textContent, 'error');
            return;
          }

          const payload = {
            fullName,
            username,
            password,
            email,
            phone
          };

          const result = await api('/admin/teachers', {
            method: 'POST',
            body: JSON.stringify(payload)
          });

          if (result.data?.teacher?.username) {
            state.adminTeacherSecrets[result.data.teacher.username] = payload.password;
          }

          status.textContent = 'Teacher account created.';
          showToast('Teacher account created successfully.', 'success');
          await renderAdminDashboard();
        } catch (error) {
          status.textContent = error.message;
          showToast(error.message, 'error');
        }
      });
    });
  }

  const adminCreateCourseBtn = document.getElementById('adminCreateCourseBtn');
  if (adminCreateCourseBtn) {
    adminCreateCourseBtn.addEventListener('click', async () => {
      const status = document.getElementById('adminCreateCourseStatus');
      const form = document.getElementById('adminCreateCourseForm');
      if (form && !form.reportValidity()) return;
      status.textContent = 'Creating course...';

      await withButtonLoading(adminCreateCourseBtn, 'Creating...', async () => {
        try {
          const name = sanitizeValue(document.getElementById('adminCourseName').value);
          const courseDuration = sanitizeValue(document.getElementById('adminCourseDuration').value);
          const syllabusFile =
            document.getElementById('adminCourseSyllabusPdfFile').files?.[0] || null;

          if (name.length < 2) {
            status.textContent = 'Course name must be at least 2 characters.';
            showToast(status.textContent, 'error');
            return;
          }
          if (courseDuration.length < 2) {
            status.textContent = 'Course duration is required.';
            showToast(status.textContent, 'error');
            return;
          }
          if (!syllabusFile || !/\.pdf$/i.test(syllabusFile.name)) {
            status.textContent = 'Please upload syllabus as a PDF file.';
            showToast(status.textContent, 'error');
            return;
          }

          status.textContent = 'Uploading syllabus...';
          const uploadedSyllabus = await uploadAsset(syllabusFile, 'syllabus');

          await api('/admin/subjects', {
            method: 'POST',
            body: JSON.stringify({
              name,
              courseDuration,
              syllabusPdfUrl: uploadedSyllabus.url,
              syllabusPdfName: syllabusFile.name
            })
          });

          status.textContent = 'Course created.';
          showToast('Course created successfully.', 'success');
          await renderAdminDashboard();
        } catch (error) {
          status.textContent = error.message;
          showToast(error.message, 'error');
        }
      });
    });
  }

  let adminSyllabusUpdateSubjectId = '';
  const adminUpdateSyllabusFileInput = document.getElementById('adminUpdateSyllabusFileInput');
  const adminUpdateSyllabusStatus = document.getElementById('adminUpdateSyllabusStatus');

  document.querySelectorAll('[data-admin-update-syllabus]').forEach((button) => {
    button.addEventListener('click', () => {
      adminSyllabusUpdateSubjectId = button.getAttribute('data-admin-update-syllabus') || '';
      if (!adminSyllabusUpdateSubjectId || !adminUpdateSyllabusFileInput) return;
      adminUpdateSyllabusFileInput.value = '';
      adminUpdateSyllabusFileInput.click();
    });
  });

  if (adminUpdateSyllabusFileInput) {
    adminUpdateSyllabusFileInput.addEventListener('change', async () => {
      const syllabusFile = adminUpdateSyllabusFileInput.files?.[0] || null;
      if (!adminSyllabusUpdateSubjectId || !syllabusFile) return;
      if (!/\.pdf$/i.test(syllabusFile.name)) {
        if (adminUpdateSyllabusStatus) {
          adminUpdateSyllabusStatus.textContent = 'Please upload a PDF file.';
        }
        showToast('Please upload a PDF file.', 'error');
        return;
      }

      if (adminUpdateSyllabusStatus) {
        adminUpdateSyllabusStatus.textContent = 'Uploading new syllabus...';
      }

      try {
        const uploadedSyllabus = await uploadAsset(syllabusFile, 'syllabus');
        await api(`/admin/subjects/${adminSyllabusUpdateSubjectId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            syllabusPdfUrl: uploadedSyllabus.url,
            syllabusPdfName: syllabusFile.name
          })
        });
        if (adminUpdateSyllabusStatus) {
          adminUpdateSyllabusStatus.textContent = 'Syllabus updated successfully.';
        }
        showToast('Syllabus updated.', 'success');
        await renderAdminDashboard();
      } catch (error) {
        if (adminUpdateSyllabusStatus) {
          adminUpdateSyllabusStatus.textContent = error.message;
        }
        showToast(error.message, 'error');
      }
    });
  }

  document.querySelectorAll('[data-admin-edit-course]').forEach((button) => {
    button.addEventListener('click', async () => {
      const subjectId = button.getAttribute('data-admin-edit-course');
      if (!subjectId) return;
      const course = subjects.find((item) => item._id === subjectId);
      if (!course) return;

      const nextName = prompt('Course name', course.name || '');
      if (nextName === null) return;
      const cleanName = sanitizeValue(nextName);
      if (cleanName.length < 2) {
        showToast('Course name must be at least 2 characters.', 'error');
        return;
      }

      const nextDuration = prompt('Course duration', course.courseDuration || '');
      if (nextDuration === null) return;
      const cleanDuration = sanitizeValue(nextDuration);
      if (cleanDuration.length < 2) {
        showToast('Course duration is required.', 'error');
        return;
      }

      await withButtonLoading(button, 'Saving...', async () => {
        try {
          await api(`/admin/subjects/${subjectId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              name: cleanName,
              courseDuration: cleanDuration
            })
          });
          showToast('Course updated successfully.', 'success');
          await renderAdminDashboard();
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  });

  document.querySelectorAll('[data-admin-delete-course]').forEach((button) => {
    button.addEventListener('click', async () => {
      const subjectId = button.getAttribute('data-admin-delete-course');
      if (!subjectId) return;
      if (
        !confirm(
          'Delete this course? It will be removed from student course assignments across this institution.'
        )
      ) {
        return;
      }

      await withButtonLoading(button, 'Deleting...', async () => {
        try {
          await api(`/admin/subjects/${subjectId}`, { method: 'DELETE' });
          showToast('Course deleted.', 'success');
          await renderAdminDashboard();
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  });

  document.querySelectorAll('[data-edit-teacher]').forEach((button) => {
    button.addEventListener('click', async () => {
      const teacherId = button.getAttribute('data-edit-teacher');
      if (!teacherId) return;
      const teacher = teachers.find((item) => item._id === teacherId);
      if (!teacher) return;

      const nextFullName = prompt('Teacher full name', teacher.fullName || '');
      if (nextFullName === null) return;
      const fullName = sanitizeValue(nextFullName);
      if (fullName.length < 2) {
        showToast('Full name must be at least 2 characters.', 'error');
        return;
      }

      const nextUsername = prompt('Teacher username', teacher.username || '');
      if (nextUsername === null) return;
      const username = sanitizeValue(nextUsername).toLowerCase();
      if (username.length < 3) {
        showToast('Username must be at least 3 characters.', 'error');
        return;
      }

      const nextEmail = prompt('Teacher email (optional)', teacher.email || '') ?? '';
      const email = String(nextEmail || '').trim();
      const nextPhone = prompt('Teacher phone (optional)', teacher.phone || '') ?? '';
      const phone = String(nextPhone || '').trim();

      await withButtonLoading(button, 'Saving...', async () => {
        try {
          await api(`/admin/teachers/${teacherId}`, {
            method: 'PATCH',
            body: JSON.stringify({ fullName, username, email, phone })
          });
          showToast('Teacher details updated.', 'success');
          await renderAdminDashboard();
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  });

  const searchInput = document.getElementById('adminStudentSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      const nextValue = event.target.value;
      debounceByKey('admin-student-search', () => {
        state.adminStudentQuery = nextValue;
        void renderAdminDashboard();
      });
    });
  }

  const subjectFilter = document.getElementById('adminSubjectFilter');
  if (subjectFilter) {
    subjectFilter.addEventListener('change', (event) => {
      state.adminSubjectFilter = event.target.value;
      void renderAdminDashboard();
    });
  }

  document.querySelectorAll('[data-copy-teacher-creds]').forEach((button) => {
    button.addEventListener('click', async () => {
      const username = button.getAttribute('data-copy-teacher-creds');
      if (!username) return;
      const teacher = teachers.find((item) => item.username === username);
      const tempPassword = getTeacherTempPassword(teacher);
      if (!tempPassword) {
        showToast('Temporary password not available for this teacher.', 'error');
        return;
      }
      const copyText = [
        'LIFT Educations login',
        `Institution ID: ${state.session.institutionId}`,
        `Username: ${username}`,
        `Temporary Password: ${tempPassword}`
      ].join('\n');
      try {
        await copyTextToClipboard(copyText);
        showToast('Teacher credentials copied.', 'success');
      } catch (error) {
        showToast('Could not copy. Please copy manually.', 'error');
      }
    });
  });

  document.querySelectorAll('[data-reset-teacher-password]').forEach((button) => {
    button.addEventListener('click', async () => {
      const teacherId = button.getAttribute('data-reset-teacher-password');
      const teacherUsername = button.getAttribute('data-reset-teacher-username') || 'this teacher';
      if (!teacherId) return;

      const input = prompt(
        `Set a new temporary password for ${teacherUsername}`,
        generateTempPassword()
      );
      if (input === null) return;
      const password = String(input || '').trim();
      if (password.length < 6) {
        showToast('Temporary password must be at least 6 characters.', 'error');
        return;
      }

      await withButtonLoading(button, 'Saving...', async () => {
        try {
          const result = await api(`/admin/teachers/${teacherId}/reset-password`, {
            method: 'POST',
            body: JSON.stringify({ password })
          });
          const updatedUsername =
            result?.data?.teacher?.username ||
            (teacherUsername !== 'this teacher' ? teacherUsername : '');
          const updatedPassword = result?.data?.teacher?.temporaryPassword || password;
          if (updatedUsername) state.adminTeacherSecrets[updatedUsername] = updatedPassword;
          showToast('Temporary password reset successfully.', 'success');
          await renderAdminDashboard();
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  });

  document.querySelectorAll('[data-delete-teacher]').forEach((button) => {
    button.addEventListener('click', async () => {
      const teacherId = button.getAttribute('data-delete-teacher');
      if (!teacherId) return;
      if (!confirm('Delete this teacher account? This teacher will no longer be able to login.')) {
        return;
      }

      await withButtonLoading(button, 'Deleting...', async () => {
        try {
          await api(`/admin/teachers/${teacherId}`, { method: 'DELETE' });
          showToast('Teacher deleted.', 'success');
          await renderAdminDashboard();
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  });

  const exportTeacherCredsCsvBtn = document.getElementById('exportTeacherCredsCsvBtn');
  if (exportTeacherCredsCsvBtn) {
    exportTeacherCredsCsvBtn.addEventListener('click', () => {
      const rows = teachers
        .map((teacher) => ({
          fullName: teacher.fullName || '',
          username: teacher.username || '',
          tempPassword: getTeacherTempPassword(teacher),
          email: teacher.email || '',
          phone: teacher.phone || '',
          institutionId: state.session.institutionId
        }))
        .filter((row) => row.tempPassword);

      if (!rows.length) {
        showToast('No temporary passwords available to export.', 'error');
        return;
      }

      downloadCsv(
        'teacher-credentials.csv',
        ['institutionId', 'fullName', 'username', 'tempPassword', 'email', 'phone'],
        rows
      );
      showToast('Teacher credentials CSV exported.', 'success');
    });
  }

  bindAccountPasswordForm();
  endNavTransition();
}

async function renderTeacherDashboard() {
  clearAttemptTimer();
  beginNavTransition();

  if (state.teacherTab === 'tests') state.teacherTab = 'assessment_conduct';
  if (state.teacherTab === 'assessment') state.teacherTab = 'assessment_results';

  const user = state.session?.user || { fullName: '', username: '' };
  const shouldLoadSubjects = state.teacherTab !== 'accounts';
  const shouldLoadStudents =
    state.teacherTab === 'students' ||
    state.teacherTab === 'assessment_conduct' ||
    state.teacherTab === 'dashboard';
  const shouldLoadResources = state.teacherTab === 'resources' || state.teacherTab === 'dashboard';
  const shouldLoadTests = state.teacherTab === 'assessment_conduct' || state.teacherTab === 'dashboard';
  const shouldLoadDashboardPlans = state.teacherTab === 'dashboard';
  const shouldLoadClassPlans = state.teacherTab === 'class_planner';
  const shouldLoadAssessments = state.teacherTab === 'assessment_results';
  const shouldLoadLiveStats = state.teacherTab === 'assessment_results';

  const subjectsResult = shouldLoadSubjects
    ? await api('/teacher/subjects')
    : { data: { subjects: [] } };

  const subjects = subjectsResult.data.subjects || [];
  if (state.teacherSubjectFilter && !subjects.some((item) => item._id === state.teacherSubjectFilter)) {
    state.teacherSubjectFilter = '';
  }
  if (
    state.teacherResourceSubjectId &&
    !subjects.some((item) => item._id === state.teacherResourceSubjectId)
  ) {
    state.teacherResourceSubjectId = '';
  }
  if (state.teacherTestSubjectId && !subjects.some((item) => item._id === state.teacherTestSubjectId)) {
    state.teacherTestSubjectId = '';
  }
  if (
    state.teacherAssessmentSubjectId &&
    !subjects.some((item) => item._id === state.teacherAssessmentSubjectId)
  ) {
    state.teacherAssessmentSubjectId = '';
  }
  const studentQuery = toQueryString({
    q: state.teacherTab === 'students' ? state.teacherStudentQuery : '',
    subjectId: state.teacherTab === 'students' ? state.teacherSubjectFilter : ''
  });
  const studentsPromise = shouldLoadStudents
    ? api(`/teacher/students${state.teacherTab === 'students' ? studentQuery : ''}`)
    : Promise.resolve({ data: { students: [] } });

  const resourcesQuery =
    state.teacherTab === 'resources'
      ? toQueryString({
          subjectId: state.teacherResourceSubjectId,
          resourceType: state.teacherResourceType,
          q: state.teacherResourceSearch
        })
      : '';
  const resourcesPromise = shouldLoadResources
    ? api(`/teacher/resources${resourcesQuery}`)
    : Promise.resolve({ data: { resources: [] } });

  const testsQuery = toQueryString({
    subjectId: state.teacherTestSubjectId
  });
  const testsPromise = shouldLoadTests
    ? api(`/teacher/tests${testsQuery}`)
    : Promise.resolve({ data: { tests: [] } });

  const dashboardPlansPromise = shouldLoadDashboardPlans
    ? api(`/teacher/class-plans${toQueryString({ date: todayIsoDate() })}`)
    : Promise.resolve({ data: { plans: [] } });

  const classPlansPromise = shouldLoadClassPlans
    ? api(
        `/teacher/class-plans${toQueryString({ date: state.teacherClassPlanDate || todayIsoDate() })}`
      )
    : Promise.resolve({ data: { plans: [] } });

  const assessmentsPromise = shouldLoadAssessments
    ? api(
        `/teacher/assessments${toQueryString({
          subjectId: state.teacherAssessmentSubjectId,
          type: state.teacherAssessmentType,
          status: state.teacherAssessmentStatus,
          q: state.teacherAssessmentQuery
        })}`
      )
    : Promise.resolve({ data: { assessments: [] } });

  const liveStatsPromise = shouldLoadLiveStats
    ? api('/teacher/tests/live-stats')
    : Promise.resolve({ data: { liveTests: [] } });

  const [
    studentsResult,
    resourcesResult,
    testsResult,
    dashboardPlansResult,
    classPlansResult,
    assessmentsResult,
    liveStatsResult
  ] = await Promise.all([
    studentsPromise,
    resourcesPromise,
    testsPromise,
    dashboardPlansPromise,
    classPlansPromise,
    assessmentsPromise,
    liveStatsPromise
  ]);

  const students = studentsResult.data.students || [];
  const availableStudentsForTest = state.teacherTestSubjectId
    ? students.filter((student) =>
        (student.subjects || []).some(
          (item) => resolveSubjectId(item) === state.teacherTestSubjectId
        )
      )
    : [];

  if (state.teacherTestAudienceMode !== 'all' && state.teacherTestAudienceMode !== 'selected') {
    state.teacherTestAudienceMode = 'all';
  }

  const allowedTestStudentIds = new Set(
    availableStudentsForTest.map((student) => resolveEntityId(student)).filter(Boolean)
  );
  state.teacherTestSelectedStudentIds = (state.teacherTestSelectedStudentIds || []).filter((studentId) =>
    allowedTestStudentIds.has(studentId)
  );

  const resources = resourcesResult.data.resources || [];
  const tests = testsResult.data.tests || [];
  if (state.teacherViewedTestId && !tests.some((test) => test._id === state.teacherViewedTestId)) {
    state.teacherViewedTestId = '';
  }
  const viewedTest = tests.find((test) => test._id === state.teacherViewedTestId) || null;
  if (
    state.teacherReconductDraft?.sourceTestId &&
    !tests.some((test) => test._id === state.teacherReconductDraft.sourceTestId)
  ) {
    state.teacherReconductDraft = null;
  }

  const reconductStudentPool = state.teacherReconductDraft
    ? students.filter((student) =>
        (student.subjects || []).some(
          (item) => resolveSubjectId(item) === state.teacherReconductDraft.subjectId
        )
      )
    : [];
  if (state.teacherReconductDraft) {
    const allowed = new Set(
      reconductStudentPool.map((item) => resolveEntityId(item)).filter(Boolean)
    );
    state.teacherReconductDraft.selectedStudentIds = (state.teacherReconductDraft.selectedStudentIds || []).filter(
      (studentId) => allowed.has(studentId)
    );
  }

  const dashboardClassPlans = dashboardPlansResult.data.plans || [];
  const classPlans = classPlansResult.data.plans || [];
  const assessments = assessmentsResult.data.assessments || [];
  const liveTestStats = liveStatsResult.data.liveTests || [];

  schedulePrefetch(
    ['/teacher/subjects', '/teacher/students', '/teacher/resources', '/teacher/tests', '/teacher/class-plans'],
    'teacher-core'
  );

  app.innerHTML = `
    <div class="dashboard-shell">
      <header class="main-nav">
        <div class="left-nav">
          ${logoMarkup(true)}
          ${teacherNavMarkup(state.teacherTab)}
        </div>
        <div class="top-actions">
          <button class="signout" id="logoutBtn">Sign Out</button>
        </div>
      </header>

      <main class="page container-xl">
        <h2>Welcome, ${escapeHtml(user.fullName)} 👋</h2>
        <p class="subline">Manage classes, subjects, students and tests from one place.</p>
        ${smokeReportMarkup(state.qaReports.teacher)}

        ${
          state.teacherTab === 'dashboard'
            ? `
              <section class="stats-grid">
                <article class="panel stat"><h3>${subjects.length}</h3><p>Subjects</p></article>
                <article class="panel stat"><h3>${students.length}</h3><p>Students</p></article>
                <article class="panel stat"><h3>${resources.length}</h3><p>Resources</p></article>
                <article class="panel stat"><h3>${tests.length}</h3><p>Published Tests</p></article>
              </section>

              <section class="panel">
                <div class="progress-row">
                  <h3>Today’s Class Schedule</h3>
                  <button class="mini-btn" data-teacher-tab="class_planner">Open Planner</button>
                </div>
                ${
                  dashboardClassPlans.length
                    ? dashboardClassPlans
                        .slice(0, 6)
                        .map(
                          (plan) => `
                            <article class="stack-item pending-item">
                              <div>
                                <p><strong>${escapeHtml(plan.title)}</strong></p>
                                <p class="muted">${escapeHtml(plan.subjectName || '-')} | ${escapeHtml(plan.startTime || '--:--')} - ${escapeHtml(plan.endTime || '--:--')}</p>
                              </div>
                            </article>
                          `
                        )
                        .join('')
                    : '<p class="muted">No classes planned for today.</p>'
                }
              </section>
            `
            : ''
        }

        ${
          state.teacherTab === 'subjects'
            ? `
              <section class="panel table-panel">
                <h3>Syllabus Manager</h3>
                <p class="muted">Subjects and syllabus are managed by Admin for consistency across teachers.</p>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Subject</th>
                        <th>Syllabus</th>
                        <th>Last Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        subjects.length
                          ? subjects
                              .map(
                                (subject) => `
                                  <tr>
                                    <td>${escapeHtml(subject.name)}</td>
                                    <td>${
                                      subject.syllabusPdfUrl
                                        ? `<a href="${escapeHtml(subject.syllabusPdfUrl)}" target="_blank" rel="noreferrer">Open Syllabus</a>`
                                        : '-'
                                    }</td>
                                    <td>${formatDate(subject.updatedAt || subject.createdAt)}</td>
                                  </tr>
                                `
                              )
                              .join('')
                          : '<tr><td colspan="3">No subjects created by Admin yet.</td></tr>'
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            `
            : ''
        }

        ${
          state.teacherTab === 'students'
            ? `
              <section class="panel">
                <h3>Create Student</h3>
                <form id="createStudentForm" class="two-grid-form">
                  <div>
                    <label for="studentFullName">Full Name</label>
                    <input id="studentFullName" type="text" required />
                  </div>
                  <div>
                    <label for="studentUsername">Username</label>
                    <input id="studentUsername" type="text" required />
                  </div>
                  <div>
                    <label for="studentTempPassword">Temporary Password</label>
                    <input id="studentTempPassword" type="text" minlength="6" required />
                  </div>
                  <div>
                    <label for="studentEmail">Email</label>
                    <input id="studentEmail" type="email" />
                  </div>
                  <div>
                    <label for="studentPhone">Phone</label>
                    <input id="studentPhone" type="text" />
                  </div>
                  <div>
                    <label for="studentParentEmail">Parent Email (optional)</label>
                    <input id="studentParentEmail" type="email" />
                  </div>
                  <div>
                    <label for="studentParentPhone">Parent WhatsApp (optional)</label>
                    <input id="studentParentPhone" type="text" />
                  </div>
                  <div>
                    <label for="studentSubjects">Assign Subjects</label>
                    <select id="studentSubjects" multiple required>
                      ${subjects.map((subject) => `<option value="${subject._id}">${escapeHtml(subject.name)}</option>`).join('')}
                    </select>
                  </div>
                </form>
                <button id="createStudentBtn" class="cta-main">Create Student Account</button>
                <p class="auth-note" id="createStudentStatus"></p>
              </section>

              <section class="panel">
                <h3>Student Filters</h3>
                <div class="two-grid-form">
                  <div>
                    <label for="teacherStudentSearch">Search by Name</label>
                    <input id="teacherStudentSearch" type="text" value="${escapeHtml(state.teacherStudentQuery)}" placeholder="Type student name" />
                  </div>
                  <div>
                    <label for="teacherSubjectFilter">Filter by Subject</label>
                    <select id="teacherSubjectFilter">
                      <option value="">All Subjects</option>
                      ${subjects
                        .map(
                          (subject) =>
                            `<option value="${subject._id}" ${
                              state.teacherSubjectFilter === subject._id ? 'selected' : ''
                            }>${escapeHtml(subject.name)}</option>`
                        )
                        .join('')}
                    </select>
                  </div>
                </div>
                <button id="exportStudentsCsvBtn" class="cta-soft">Export Students CSV</button>
              </section>

              <section class="panel table-panel">
                <h3>Student Directory</h3>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Username</th>
                        <th>Temp Password</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Subjects</th>
                        <th>Share</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        students.length
                          ? students
                              .map((student) => {
                                const whatsPhone = cleanPhone(student.phone);
                                const tempPassword =
                                  state.teacherStudentSecrets[student.username] ||
                                  student.temporaryPassword ||
                                  '';
                                const shareText = encodeURIComponent(
                                  `LIFT Educations login\nInstitution ID: ${state.session.institutionId}\nUsername: ${student.username}${
                                    tempPassword ? `\nTemporary Password: ${tempPassword}` : ''
                                  }`
                                );
                                const subjectsText = (student.subjects || [])
                                  .map((item) => item.name)
                                  .filter(Boolean)
                                  .join(', ');
                                return `
                                  <tr>
                                    <td>${escapeHtml(student.fullName)}</td>
                                    <td>${escapeHtml(student.username)}</td>
                                    <td>${tempPassword ? escapeHtml(tempPassword) : '<span class="muted">not available</span>'}</td>
                                    <td>${escapeHtml(student.email || '-')}</td>
                                    <td>${escapeHtml(student.phone || '-')}</td>
                                    <td>${escapeHtml(subjectsText || '-')}</td>
                                    <td>
                                      ${
                                        student.email
                                          ? `<a href="mailto:${escapeHtml(student.email)}?subject=${encodeURIComponent(
                                              'Your LIFT Login Credentials'
                                            )}&body=${shareText}">Email</a>`
                                          : '-'
                                      }
                                      ${
                                        whatsPhone
                                          ? ` | <a href="https://wa.me/${whatsPhone}?text=${shareText}" target="_blank" rel="noreferrer">WhatsApp</a>`
                                          : ''
                                      }
                                    </td>
                                    <td><button class="mini-btn danger" data-delete-student="${student._id}">Delete</button></td>
                                  </tr>
                                `;
                              })
                              .join('')
                          : '<tr><td colspan="8">No students found.</td></tr>'
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            `
            : ''
        }

        ${
          state.teacherTab === 'class_planner'
            ? `
              <section class="panel">
                <h3>Plan Today’s Class</h3>
                <form id="createClassPlanForm" class="two-grid-form">
                  <div>
                    <label for="classPlanSubjectId">Subject</label>
                    <select id="classPlanSubjectId" required>
                      <option value="">Select Subject</option>
                      ${subjects.map((subject) => `<option value="${subject._id}">${escapeHtml(subject.name)}</option>`).join('')}
                    </select>
                  </div>
                  <div>
                    <label for="classPlanTitle">Class Title</label>
                    <input id="classPlanTitle" type="text" required />
                  </div>
                  <div>
                    <label for="classPlanScheduledDate">Date</label>
                    <input id="classPlanScheduledDate" type="date" value="${escapeHtml(state.teacherClassPlanDate || todayIsoDate())}" required />
                  </div>
                  <div>
                    <label for="classPlanStartTime">Start Time</label>
                    <input id="classPlanStartTime" type="time" />
                  </div>
                  <div>
                    <label for="classPlanEndTime">End Time</label>
                    <input id="classPlanEndTime" type="time" />
                  </div>
                  <div>
                    <label for="classPlanDescription">Class Notes (optional)</label>
                    <input id="classPlanDescription" type="text" placeholder="What will be covered today" />
                  </div>
                </form>

                <section class="builder-box">
                  <h3>Attach Resource (optional)</h3>
                  <div class="two-grid-form">
                    <div>
                      <label for="classPlanResourceType">Resource Type</label>
                      <select id="classPlanResourceType">
                        <option value="pdf" ${state.teacherClassPlanResourceType === 'pdf' ? 'selected' : ''}>PDF</option>
                        <option value="ebook" ${state.teacherClassPlanResourceType === 'ebook' ? 'selected' : ''}>EBook</option>
                        <option value="video" ${state.teacherClassPlanResourceType === 'video' ? 'selected' : ''}>Video</option>
                        <option value="link" ${state.teacherClassPlanResourceType === 'link' ? 'selected' : ''}>Link</option>
                      </select>
                    </div>
                    <div>
                      <label for="classPlanResourceTitle">Resource Title</label>
                      <input id="classPlanResourceTitle" type="text" placeholder="Optional" />
                    </div>
                    <div>
                      ${
                        state.teacherClassPlanResourceType === 'pdf' ||
                        state.teacherClassPlanResourceType === 'ebook'
                          ? `
                            <label for="classPlanResourceFile">Upload File</label>
                            <input id="classPlanResourceFile" type="file" accept="${
                              state.teacherClassPlanResourceType === 'pdf'
                                ? '.pdf,application/pdf'
                                : '.pdf,.epub,.mobi,.azw3,application/pdf'
                            }" />
                          `
                          : `
                            <label for="classPlanResourceValue">Resource URL</label>
                            <input id="classPlanResourceValue" type="url" placeholder="https://..." />
                          `
                      }
                    </div>
                    <div>
                      <label for="classPlanResourceKeywords">Keywords (optional)</label>
                      <input id="classPlanResourceKeywords" type="text" placeholder="chapter, topic" />
                    </div>
                  </div>
                </section>

                <button id="createClassPlanBtn" class="cta-main">Save Class Plan</button>
                <p class="auth-note" id="createClassPlanStatus"></p>
              </section>

              <section class="panel table-panel">
                <div class="progress-row">
                  <h3>Class Plan Schedule</h3>
                  <input id="teacherClassPlanDate" type="date" value="${escapeHtml(state.teacherClassPlanDate || todayIsoDate())}" />
                </div>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Subject</th>
                        <th>Class</th>
                        <th>Resource</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        classPlans.length
                          ? classPlans
                              .map(
                                (plan) => `
                                  <tr>
                                    <td>${escapeHtml(plan.startTime || '--:--')} - ${escapeHtml(plan.endTime || '--:--')}</td>
                                    <td>${escapeHtml(plan.subjectName || '-')}</td>
                                    <td>
                                      <strong>${escapeHtml(plan.title || '-')}</strong>
                                      <br />
                                      <small>${escapeHtml(plan.description || '')}</small>
                                    </td>
                                    <td>
                                      ${
                                        plan.resource
                                          ? `<a href="${escapeHtml(plan.resource.value)}" target="_blank" rel="noreferrer">Open</a>`
                                          : '-'
                                      }
                                    </td>
                                    <td><button class="mini-btn danger" data-delete-class-plan="${plan.id}">Delete</button></td>
                                  </tr>
                                `
                              )
                              .join('')
                          : '<tr><td colspan="5">No classes planned for this date.</td></tr>'
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            `
            : ''
        }

        ${
          state.teacherTab === 'resources'
            ? `
              <section class="panel">
                <h3>Upload Resource</h3>
                <form id="createResourceForm" class="two-grid-form">
                  <div>
                    <label for="resourceSubjectId">Subject</label>
                    <select id="resourceSubjectId" required>
                      <option value="">Select Subject</option>
                      ${subjects.map((subject) => `<option value="${subject._id}">${escapeHtml(subject.name)}</option>`).join('')}
                    </select>
                  </div>
                  <div>
                    <label for="resourceType">Resource Type</label>
                    <select id="resourceType" required>
                      <option value="pdf" ${state.teacherResourceCreateType === 'pdf' ? 'selected' : ''}>PDF</option>
                      <option value="ebook" ${state.teacherResourceCreateType === 'ebook' ? 'selected' : ''}>EBook</option>
                      <option value="video" ${state.teacherResourceCreateType === 'video' ? 'selected' : ''}>Video</option>
                      <option value="link" ${state.teacherResourceCreateType === 'link' ? 'selected' : ''}>Link</option>
                    </select>
                  </div>
                  <div>
                    <label for="resourceTitle">Title</label>
                    <input id="resourceTitle" type="text" required />
                  </div>
                  <div>
                    ${
                      state.teacherResourceCreateType === 'pdf' ||
                      state.teacherResourceCreateType === 'ebook'
                        ? `
                          <label for="resourceFile">Upload File</label>
                          <input id="resourceFile" type="file" accept="${
                            state.teacherResourceCreateType === 'pdf'
                              ? '.pdf,application/pdf'
                              : '.pdf,.epub,.mobi,.azw3,application/pdf'
                          }" required />
                        `
                        : `
                          <label for="resourceValue">Resource URL</label>
                          <input id="resourceValue" type="url" placeholder="${
                            state.teacherResourceCreateType === 'video'
                              ? 'https://www.youtube.com/watch?v=...'
                              : 'https://...'
                          }" required />
                        `
                    }
                  </div>
                  <div>
                    <label for="resourceKeywords">Keywords (comma separated)</label>
                    <input id="resourceKeywords" type="text" />
                  </div>
                </form>
                <button id="createResourceBtn" class="cta-main">Upload Resource</button>
                <p class="auth-note" id="createResourceStatus"></p>
              </section>

              <section class="panel">
                <h3>Search Resources</h3>
                <div class="two-grid-form">
                  <div>
                    <label for="teacherResourceSearch">Search</label>
                    <input id="teacherResourceSearch" type="text" value="${escapeHtml(state.teacherResourceSearch)}" placeholder="Search title/keywords" />
                  </div>
                  <div>
                    <label for="teacherResourceType">Type</label>
                    <select id="teacherResourceType">
                      <option value="">All</option>
                      <option value="pdf" ${state.teacherResourceType === 'pdf' ? 'selected' : ''}>PDF</option>
                      <option value="ebook" ${state.teacherResourceType === 'ebook' ? 'selected' : ''}>EBook</option>
                      <option value="video" ${state.teacherResourceType === 'video' ? 'selected' : ''}>Video</option>
                      <option value="link" ${state.teacherResourceType === 'link' ? 'selected' : ''}>Link</option>
                    </select>
                  </div>
                  <div>
                    <label for="teacherResourceSubjectId">Subject</label>
                    <select id="teacherResourceSubjectId">
                      <option value="">All Subjects</option>
                      ${subjects
                        .map(
                          (subject) =>
                            `<option value="${subject._id}" ${
                              state.teacherResourceSubjectId === subject._id ? 'selected' : ''
                            }>${escapeHtml(subject.name)}</option>`
                        )
                        .join('')}
                    </select>
                  </div>
                </div>
              </section>

              <section class="panel table-panel">
                <h3>Resource Library</h3>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Type</th>
                        <th>Resource</th>
                        <th>Created</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        resources.length
                          ? resources
                              .map(
                                (resource) => `
                                  <tr>
                                    <td>${escapeHtml(resource.title)}</td>
                                    <td>${escapeHtml(resource.resourceType.toUpperCase())}</td>
                                    <td>
                                      ${
                                        resource.source === 'file'
                                          ? `<a href="${escapeHtml(resource.value)}" target="_blank" rel="noreferrer">Open</a>`
                                          : `<a href="${escapeHtml(resource.value)}" target="_blank" rel="noreferrer">Open</a>`
                                      }
                                    </td>
                                    <td>${formatDate(resource.createdAt)}</td>
                                    <td><button class="mini-btn danger" data-delete-resource="${resource._id}">Delete</button></td>
                                  </tr>
                                `
                              )
                              .join('')
                          : '<tr><td colspan="5">No resources found.</td></tr>'
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            `
            : ''
        }

        ${
          state.teacherTab === 'assessment_conduct'
            ? `
              <section class="panel">
                <h3>Conduct Test</h3>
                <p class="muted">Choose test format from the dropdown, add questions, and optionally schedule an attendance window.</p>
                <form id="createTestForm" class="two-grid-form">
                  <div>
                    <label for="testSubjectId">Subject</label>
                    <select id="testSubjectId" required>
                      <option value="">Select Subject</option>
                      ${subjects.map((subject) => `<option value="${subject._id}" ${state.teacherTestSubjectId === subject._id ? 'selected' : ''}>${escapeHtml(subject.name)}</option>`).join('')}
                    </select>
                  </div>
                  <div>
                    <label for="testTitle">Title</label>
                    <input id="testTitle" type="text" required />
                  </div>
                  <div>
                    <label for="testType">Test Mode</label>
                    <select id="testType">
                      <option value="mcq" ${state.teacherTestType === 'mcq' ? 'selected' : ''}>MCQ</option>
                      <option value="pdf_upload" ${state.teacherTestType === 'pdf_upload' ? 'selected' : ''}>Upload Questions as PDF</option>
                    </select>
                  </div>
                  ${
                    state.teacherTestType === 'mcq'
                      ? `
                        <div>
                          <label for="mcqQuestionCount">Number of Questions (MCQ)</label>
                          <input
                            id="mcqQuestionCount"
                            type="number"
                            min="${MCQ_MIN_QUESTION_COUNT}"
                            max="${MCQ_MAX_QUESTION_COUNT}"
                            value="${escapeHtml(state.teacherMcqQuestionCount || '')}"
                            placeholder="Choose question count"
                            required
                          />
                        </div>
                        <div>
                          <label for="testDuration">Duration of the Exam (MCQ)</label>
                          <select id="testDuration">
                            <option value="5" ${Number(state.teacherMcqDurationMinutes) === 5 ? 'selected' : ''}>5</option>
                            <option value="10" ${Number(state.teacherMcqDurationMinutes) === 10 ? 'selected' : ''}>10</option>
                            <option value="15" ${Number(state.teacherMcqDurationMinutes) === 15 ? 'selected' : ''}>15</option>
                            <option value="20" ${Number(state.teacherMcqDurationMinutes) === 20 ? 'selected' : ''}>20</option>
                            <option value="30" ${Number(state.teacherMcqDurationMinutes) === 30 ? 'selected' : ''}>30</option>
                            <option value="45" ${Number(state.teacherMcqDurationMinutes) === 45 ? 'selected' : ''}>45</option>
                            <option value="60" ${Number(state.teacherMcqDurationMinutes) === 60 ? 'selected' : ''}>60</option>
                          </select>
                        </div>
                        <div>
                          <label for="mcqCorrectMark">Marks for Right Answer</label>
                          <input
                            id="mcqCorrectMark"
                            type="number"
                            min="0.01"
                            max="100"
                            step="0.01"
                            value="${escapeHtml(state.teacherMcqCorrectMark)}"
                            required
                          />
                        </div>
                        <div>
                          <label for="mcqWrongMark">Marks for Wrong Answer</label>
                          <input
                            id="mcqWrongMark"
                            type="number"
                            min="-100"
                            max="0"
                            step="0.01"
                            value="${escapeHtml(state.teacherMcqWrongMark)}"
                            required
                          />
                        </div>
                      `
                      : `
                        <div>
                          <label for="testDuration">Duration of the Exam (PDF Upload)</label>
                          <select id="testDuration">
                            <option value="30" ${Number(state.teacherPdfDurationMinutes) === 30 ? 'selected' : ''}>30</option>
                            <option value="60" ${Number(state.teacherPdfDurationMinutes) === 60 ? 'selected' : ''}>60</option>
                            <option value="90" ${Number(state.teacherPdfDurationMinutes) === 90 ? 'selected' : ''}>90</option>
                            <option value="120" ${Number(state.teacherPdfDurationMinutes) === 120 ? 'selected' : ''}>120</option>
                          </select>
                        </div>
                      `
                  }
                  <div>
                    <label for="testAudienceMode">Audience</label>
                    <select id="testAudienceMode">
                      <option value="all" ${state.teacherTestAudienceMode === 'all' ? 'selected' : ''}>All students in selected subject</option>
                      <option value="selected" ${state.teacherTestAudienceMode === 'selected' ? 'selected' : ''}>Selected students only</option>
                    </select>
                  </div>
                  <div>
                    <label for="testScheduleEnabled">Schedule Window</label>
                    <label class="option-row">
                      <input id="testScheduleEnabled" type="checkbox" ${state.teacherTestScheduleEnabled ? 'checked' : ''} />
                      <span>Enable schedule (example: 5:00 PM to 7:00 PM)</span>
                    </label>
                  </div>
                </form>

                ${
                  state.teacherTestScheduleEnabled
                    ? `
                      <section class="builder-box">
                        <h4>Test Availability Window</h4>
                        <div class="two-grid-form">
                          <div>
                            <label for="testScheduleDate">Date</label>
                            <input id="testScheduleDate" type="date" value="${escapeHtml(state.teacherTestScheduleDate || todayIsoDate())}" required />
                          </div>
                          <div>
                            <label for="testScheduleStartTime">Start Time</label>
                            <input id="testScheduleStartTime" type="time" value="${escapeHtml(state.teacherTestScheduleStartTime || '17:00')}" required />
                          </div>
                          <div>
                            <label for="testScheduleEndTime">End Time</label>
                            <input id="testScheduleEndTime" type="time" value="${escapeHtml(state.teacherTestScheduleEndTime || '19:00')}" required />
                          </div>
                        </div>
                      </section>
                    `
                    : ''
                }

                ${
                  state.teacherTestType === 'pdf_upload'
                    ? `
                      <section class="builder-box">
                        <div class="two-grid-form">
                          <div>
                            <label for="testPdfQuestionsFile">Upload Questions PDF</label>
                            <input id="testPdfQuestionsFile" type="file" accept=".pdf,application/pdf" required />
                          </div>
                          <div>
                            <label for="testPdfAnswerKeyFile">Upload Answer Key PDF</label>
                            <input id="testPdfAnswerKeyFile" type="file" accept=".pdf,application/pdf" required />
                          </div>
                        </div>
                        <div class="inline-btn-row">
                          <button type="button" class="mini-btn" id="previewPdfTestBtn">Preview Extracted Exam</button>
                          <span class="muted">Students will answer the extracted paper inside the app. The original question PDF stays hidden from them.</span>
                        </div>
                        <div id="teacherPdfPreviewRoot">${teacherPdfPreviewMarkup()}</div>
                        <p class="muted">Students will attempt in-system. The uploaded answer-key PDF will be available in view-only mode after submission.</p>
                      </section>
                    `
                    : ''
                }

                ${
                  state.teacherTestAudienceMode === 'selected'
                    ? `
                      <div class="test-audience-panel">
                        <div class="progress-row">
                          <h4>Select Students</h4>
                          <div class="button-row">
                            <button type="button" class="mini-btn" id="selectAllTargetsBtn">All in Subject</button>
                            <button type="button" class="mini-btn" id="clearTargetsBtn">Clear</button>
                          </div>
                        </div>
                        ${
                          !state.teacherTestSubjectId
                            ? '<p class="muted">Choose a subject first to select students.</p>'
                            : availableStudentsForTest.length
                              ? `
                                <div class="target-student-list">
                                  ${availableStudentsForTest
                                    .map((student) => {
                                      const studentId = resolveEntityId(student);
                                      if (!studentId) return '';
                                      return `
                                        <label class="target-student-item">
                                          <input
                                            type="checkbox"
                                            data-test-target-student="${studentId}"
                                            ${state.teacherTestSelectedStudentIds.includes(studentId) ? 'checked' : ''}
                                          />
                                          <span>${escapeHtml(student.fullName)} <small>@${escapeHtml(student.username)}</small></span>
                                        </label>
                                      `;
                                    })
                                    .join('')}
                                </div>
                              `
                              : '<p class="muted">No students found for this subject yet.</p>'
                        }
                      </div>
                    `
                    : ''
                }

                ${
                  state.teacherTestType === 'mcq'
                    ? getValidMcqQuestionCount(state.teacherMcqQuestionCount)
                      ? objectiveQuestionBuilderMarkup(state.teacherMcqQuestionCount)
                      : `
                        <section class="builder-box">
                          <p class="muted">Choose the number of MCQ questions to open the question form.</p>
                        </section>
                      `
                    : ''
                }

                <button id="createTestBtn" class="cta-main">Publish Test</button>
                <p class="auth-note" id="createTestStatus"></p>
              </section>

              <section class="panel table-panel">
                <h3>Published Tests</h3>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Type</th>
                        <th>Audience</th>
                        <th>Duration</th>
                        <th>Schedule</th>
                        <th>Created</th>
                        <th>View Test</th>
                        <th>Edit & Re-conduct</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        tests.length
                          ? tests
                              .map(
                                (test) => `
                                  <tr>
                                    <td>${escapeHtml(test.title)}</td>
                                    <td>${escapeHtml(formatTestType(test.type))}</td>
                                    <td>${test.audienceMode === 'selected' ? 'Selected Students' : 'All Students'}</td>
                                    <td>${escapeHtml(test.durationMinutes)} min</td>
                                    <td>${
                                      test.scheduledStartAt && test.scheduledEndAt
                                        ? `${escapeHtml(formatDate(test.scheduledStartAt))}<br /><small>${escapeHtml(formatTime(test.scheduledEndAt))}</small>`
                                        : 'Immediate'
                                    }</td>
                                    <td>${formatDate(test.createdAt)}</td>
                                    <td>
                                      <button class="mini-btn" data-view-test="${test._id}">
                                        ${state.teacherViewedTestId === test._id ? 'Viewing' : 'View Test'}
                                      </button>
                                    </td>
                                    <td>
                                      ${
                                        test.type === 'mcq'
                                          ? `<button class="mini-btn" data-edit-reconduct-test="${test._id}">Edit & Re-conduct</button>`
                                          : '<span class="muted">MCQ only</span>'
                                      }
                                    </td>
                                  </tr>
                                `
                              )
                              .join('')
                          : '<tr><td colspan="8">No tests published.</td></tr>'
                      }
                    </tbody>
                  </table>
                </div>
              </section>

            `
            : ''
        }

        ${
          state.teacherTab === 'assessment_results'
            ? `
              <section class="panel">
                <h3>Evaluate Student Results</h3>
                <p class="muted">Review student submissions and assign marks for PDF-upload tests.</p>
                <div class="two-grid-form">
                  <div>
                    <label for="teacherAssessmentQuery">Search Student</label>
                    <input id="teacherAssessmentQuery" type="text" value="${escapeHtml(state.teacherAssessmentQuery)}" placeholder="Name or username" />
                  </div>
                  <div>
                    <label for="teacherAssessmentSubjectId">Subject</label>
                    <select id="teacherAssessmentSubjectId">
                      <option value="">All Subjects</option>
                      ${subjects
                        .map(
                          (subject) =>
                            `<option value="${subject._id}" ${
                              state.teacherAssessmentSubjectId === subject._id ? 'selected' : ''
                            }>${escapeHtml(subject.name)}</option>`
                        )
                        .join('')}
                    </select>
                  </div>
                  <div>
                    <label for="teacherAssessmentType">Type</label>
                    <select id="teacherAssessmentType">
                      <option value="">All</option>
                      <option value="mcq" ${state.teacherAssessmentType === 'mcq' ? 'selected' : ''}>MCQ</option>
                      <option value="long" ${state.teacherAssessmentType === 'long' ? 'selected' : ''}>Upload Questions as PDF</option>
                    </select>
                  </div>
                  <div>
                    <label for="teacherAssessmentStatus">Status</label>
                    <select id="teacherAssessmentStatus">
                      <option value="pending" ${state.teacherAssessmentStatus === 'pending' ? 'selected' : ''}>Pending</option>
                      <option value="graded" ${state.teacherAssessmentStatus === 'graded' ? 'selected' : ''}>Graded</option>
                      <option value="all" ${state.teacherAssessmentStatus === 'all' ? 'selected' : ''}>All</option>
                    </select>
                  </div>
                </div>
              </section>

              <section class="panel table-panel">
                <h3>Live Test Monitor</h3>
                <p class="muted">Track ongoing tests and attendance in real time.</p>
                ${
                  liveTestStats.length
                    ? liveTestStats
                        .map(
                          (liveTest) => `
                            <article class="stack-item">
                              <div class="progress-row">
                                <div>
                                  <p><strong>${escapeHtml(liveTest.title)}</strong></p>
                                  <p class="muted">${escapeHtml(liveTest.subjectName || '-')} | ${escapeHtml(formatTestType(liveTest.type))} | Ends in ${escapeHtml(liveTest.remainingMinutes)} min</p>
                                </div>
                                <div>
                                  <span class="alert-tag">${escapeHtml(liveTest.attendedCount)} attended</span>
                                  <span class="alert-tag alert-tag-warn">${escapeHtml(liveTest.pendingCount)} pending</span>
                                </div>
                              </div>
                              <div class="table-wrap">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Student</th>
                                      <th>Username</th>
                                      <th>Status</th>
                                      <th>Submitted At</th>
                                      <th>Score</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    ${
                                      (liveTest.students || []).length
                                        ? liveTest.students
                                            .map(
                                              (row) => `
                                                <tr>
                                                  <td>${escapeHtml(row.fullName || '-')}</td>
                                                  <td>${escapeHtml(row.username || '-')}</td>
                                                  <td>${row.attended ? '<span class="status-badge done">Attended</span>' : '<span class="status-badge pending">Pending</span>'}</td>
                                                  <td>${row.submittedAt ? escapeHtml(formatDate(row.submittedAt)) : '-'}</td>
                                                  <td>${row.scorePercent == null ? '-' : `${escapeHtml(row.scorePercent)}%`}</td>
                                                </tr>
                                              `
                                            )
                                            .join('')
                                        : '<tr><td colspan="5">No assigned students for this live test.</td></tr>'
                                    }
                                  </tbody>
                                </table>
                              </div>
                            </article>
                          `
                        )
                        .join('')
                    : '<p class="muted">No live tests right now. Schedule a test window to track it here.</p>'
                }
              </section>

              <section class="panel table-panel">
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Submitted</th>
                        <th>Student</th>
                        <th>Subject</th>
                        <th>Test</th>
                        <th>Type</th>
                        <th>Marks</th>
                        <th>Answers</th>
                        <th>Grade</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        assessments.length
                          ? assessments
                              .map((attempt) => {
                                const isSubjective = attempt.type === 'long';
                                const rawMarks =
                                  attempt.assignedMarks == null ? attempt.scorePercent : attempt.assignedMarks;
                                const scoreText =
                                  rawMarks == null ? 'Pending' : `${Number(rawMarks).toFixed(2)}`;
                                const gradeInputId = `assessment-marks-${attempt.id}`;
                                const feedbackInputId = `assessment-feedback-${attempt.id}`;
                                return `
                                  <tr>
                                    <td>${formatDate(attempt.createdAt)}</td>
                                    <td>${escapeHtml(attempt.student?.fullName || '-')}<br /><small>${escapeHtml(attempt.student?.username || '')}</small></td>
                                    <td>${escapeHtml(attempt.test?.subjectName || '-')}</td>
                                    <td>${escapeHtml(attempt.test?.title || '-')}</td>
                                    <td>${escapeHtml(formatTestType(attempt.type))}</td>
                                    <td>${escapeHtml(scoreText)}${
                                  attempt.evaluatedAt
                                    ? `<br /><small>Graded: ${escapeHtml(formatDate(attempt.evaluatedAt))}</small>`
                                    : ''
                                }</td>
                                    <td>${assessmentAnswersMarkup(attempt)}</td>
                                    <td>
                                      ${
                                        isSubjective
                                          ? `
                                            <input id="${gradeInputId}" type="number" min="0" max="100" step="1" value="${
                                              attempt.assignedMarks == null ? '' : escapeHtml(attempt.assignedMarks)
                                            }" placeholder="0-100" />
                                            <input id="${feedbackInputId}" type="text" value="${escapeHtml(
                                              attempt.teacherFeedback || ''
                                            )}" placeholder="Feedback (optional)" />
                                            <button class="mini-btn" data-grade-attempt="${attempt.id}" data-grade-input="${gradeInputId}" data-feedback-input="${feedbackInputId}">Save</button>
                                          `
                                          : '<span class="muted">Auto-scored</span>'
                                      }
                                    </td>
                                  </tr>
                                `;
                              })
                              .join('')
                          : '<tr><td colspan="8">No submissions found for current filters.</td></tr>'
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            `
            : ''
        }

        ${state.teacherTab === 'accounts' ? accountSectionMarkup(user) : ''}
        <button class="cta-soft mini-qa-btn floating-qa-btn" id="runQaBtn">Run QA Check</button>
      </main>

      ${
        viewedTest
          ? `
            <div class="test-modal-backdrop" data-close-view-test></div>
            <section class="test-modal" role="dialog" aria-modal="true" aria-label="View test downloads">
              <div class="test-modal-card">
                <div class="progress-row">
                  <h3>View Test: ${escapeHtml(viewedTest.title)}</h3>
                  <button class="mini-btn" data-close-view-test>Close</button>
                </div>
                <p class="muted">
                  ${escapeHtml(formatTestType(viewedTest.type))} | ${escapeHtml(viewedTest.durationMinutes)} min | ${
                    viewedTest.scheduledStartAt && viewedTest.scheduledEndAt
                      ? `Window: ${escapeHtml(formatTestWindow(viewedTest))}`
                      : 'Window: Immediate'
                  }
                </p>
                ${
                  viewedTest.type === 'mcq'
                    ? `<p class="muted">Marks: +${escapeHtml(viewedTest.mcqCorrectMark ?? 1)} for right, ${escapeHtml(viewedTest.mcqWrongMark ?? 0)} for wrong.</p>`
                    : ''
                }
                <div class="button-row">
                  ${
                    viewedTest.type === 'mcq'
                      ? `
                        <button class="mini-btn" data-download-viewed-combined="${viewedTest._id}">
                          Download Test + Answer Key PDF
                        </button>
                      `
                      : `
                        <button class="mini-btn" data-download-viewed-questions="${viewedTest._id}">
                          Download Questions PDF
                        </button>
                        <button class="mini-btn" data-download-viewed-answer-key="${viewedTest._id}">
                          Download Answer Key PDF
                        </button>
                      `
                  }
                </div>
              </div>
            </section>
          `
          : ''
      }

      ${
        state.teacherReconductDraft
          ? `
            <div class="test-modal-backdrop" data-close-reconduct-test></div>
            <section class="test-modal" role="dialog" aria-modal="true" aria-label="Edit and reconduct test">
              <div class="test-modal-card">
                <div class="progress-row">
                  <h3>Edit & Re-conduct MCQ Test</h3>
                  <button class="mini-btn" data-close-reconduct-test>Close</button>
                </div>
                <p class="muted">Update questions/settings and publish this as a new test for selected students.</p>

                <div class="two-grid-form">
                  <div>
                    <label for="reconductTitle">Test Title</label>
                    <input id="reconductTitle" type="text" value="${escapeHtml(state.teacherReconductDraft.title)}" />
                  </div>
                  <div>
                    <label for="reconductDuration">Duration of the Exam</label>
                    <input id="reconductDuration" type="number" min="1" max="180" value="${escapeHtml(state.teacherReconductDraft.durationMinutes)}" />
                  </div>
                  <div>
                    <label for="reconductCorrectMark">Marks for Right Answer</label>
                    <input id="reconductCorrectMark" type="number" min="0.01" max="100" step="0.01" value="${escapeHtml(state.teacherReconductDraft.mcqCorrectMark)}" />
                  </div>
                  <div>
                    <label for="reconductWrongMark">Marks for Wrong Answer</label>
                    <input id="reconductWrongMark" type="number" min="-100" max="0" step="0.01" value="${escapeHtml(state.teacherReconductDraft.mcqWrongMark)}" />
                  </div>
                  <div>
                    <label for="reconductAudienceMode">Audience</label>
                    <select id="reconductAudienceMode">
                      <option value="all" ${state.teacherReconductDraft.audienceMode === 'all' ? 'selected' : ''}>All students in subject</option>
                      <option value="selected" ${state.teacherReconductDraft.audienceMode === 'selected' ? 'selected' : ''}>Selected students only</option>
                    </select>
                  </div>
                </div>

                ${
                  state.teacherReconductDraft.audienceMode === 'selected'
                    ? `
                      <div class="test-audience-panel">
                        <div class="progress-row">
                          <h4>Select Students</h4>
                          <div class="button-row">
                            <button type="button" class="mini-btn" id="reconductSelectAllBtn">All</button>
                            <button type="button" class="mini-btn" id="reconductClearAllBtn">Clear</button>
                          </div>
                        </div>
                        ${
                          reconductStudentPool.length
                            ? `
                              <div class="target-student-list">
                                ${reconductStudentPool
                                  .map((student) => {
                                    const studentId = resolveEntityId(student);
                                    if (!studentId) return '';
                                    return `
                                      <label class="target-student-item">
                                        <input
                                          type="checkbox"
                                          data-reconduct-student="${studentId}"
                                          ${state.teacherReconductDraft.selectedStudentIds.includes(studentId) ? 'checked' : ''}
                                        />
                                        <span>${escapeHtml(student.fullName)} <small>@${escapeHtml(student.username)}</small></span>
                                      </label>
                                    `;
                                  })
                                  .join('')}
                              </div>
                            `
                            : '<p class="muted">No students found in this subject.</p>'
                        }
                      </div>
                    `
                    : ''
                }

                <section class="builder-box">
                  <h4>Questions (${escapeHtml((state.teacherReconductDraft.questions || []).length)})</h4>
                  <div class="objective-builder-grid">
                    ${(state.teacherReconductDraft.questions || [])
                      .map(
                        (question, index) => `
                          <article class="question-builder-card">
                            <h4>Question ${index + 1}</h4>
                            <input id="reconduct-q-${index}" type="text" value="${escapeHtml(question.text || '')}" />
                            <div class="builder-options">
                              <input id="reconduct-q-${index}-opt-0" type="text" value="${escapeHtml(question.options?.[0] || '')}" />
                              <input id="reconduct-q-${index}-opt-1" type="text" value="${escapeHtml(question.options?.[1] || '')}" />
                              <input id="reconduct-q-${index}-opt-2" type="text" value="${escapeHtml(question.options?.[2] || '')}" />
                              <input id="reconduct-q-${index}-opt-3" type="text" value="${escapeHtml(question.options?.[3] || '')}" />
                            </div>
                            <select id="reconduct-q-${index}-answer">
                              <option value="0" ${Number(question.correctIndex) === 0 ? 'selected' : ''}>Correct Option: A</option>
                              <option value="1" ${Number(question.correctIndex) === 1 ? 'selected' : ''}>Correct Option: B</option>
                              <option value="2" ${Number(question.correctIndex) === 2 ? 'selected' : ''}>Correct Option: C</option>
                              <option value="3" ${Number(question.correctIndex) === 3 ? 'selected' : ''}>Correct Option: D</option>
                            </select>
                          </article>
                        `
                      )
                      .join('')}
                  </div>
                </section>

                <div class="button-row">
                  <button class="cta-main" id="publishReconductBtn">Publish Re-conduct Test</button>
                  <button class="cta-soft" type="button" data-close-reconduct-test>Cancel</button>
                </div>
                <p class="auth-note" id="reconductStatus"></p>
              </div>
            </section>
          `
          : ''
      }
    </div>
  `;

  document.querySelectorAll('[data-teacher-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.teacherTab = button.getAttribute('data-teacher-tab') || 'dashboard';
      closeOpenNavDropdowns();
      void renderTeacherDashboard();
    });
  });
  bindNavDropdowns();

  document.getElementById('logoutBtn').addEventListener('click', logout);

  const runQaBtn = document.getElementById('runQaBtn');
  if (runQaBtn) {
    runQaBtn.addEventListener('click', async () => {
      if (state.qaRunningRole === 'teacher') return;
      state.qaRunningRole = 'teacher';
      await withButtonLoading(runQaBtn, 'Checking...', async () => {
        const report = await runRoleSmokeChecks('teacher');
        state.qaReports.teacher = report;
        if (report.failedCount > 0) {
          showToast(`QA finished: ${report.failedCount} check(s) failed.`, 'error', 3200);
        } else {
          showToast('QA finished: all checks passed.', 'success', 2200);
        }
      });
      state.qaRunningRole = '';
      await renderTeacherDashboard();
    });
  }

  const createStudentBtn = document.getElementById('createStudentBtn');
  if (createStudentBtn) {
    createStudentBtn.addEventListener('click', async () => {
      const status = document.getElementById('createStudentStatus');
      const form = document.getElementById('createStudentForm');
      if (form && !form.reportValidity()) return;
      status.textContent = 'Creating student...';

      await withButtonLoading(createStudentBtn, 'Creating...', async () => {
        try {
          const selectedSubjects = Array.from(
            document.getElementById('studentSubjects').selectedOptions
          ).map((option) => option.value);

          if (!selectedSubjects.length) {
            status.textContent = 'Select at least one subject.';
            showToast(status.textContent, 'error');
            return;
          }

          const payload = {
            fullName: document.getElementById('studentFullName').value.trim(),
            username: document.getElementById('studentUsername').value.trim(),
            password: document.getElementById('studentTempPassword').value,
            email: document.getElementById('studentEmail').value.trim(),
            phone: document.getElementById('studentPhone').value.trim(),
            parentEmail: document.getElementById('studentParentEmail').value.trim(),
            parentPhone: document.getElementById('studentParentPhone').value.trim(),
            subjectIds: selectedSubjects
          };

          const result = await api('/teacher/students', {
            method: 'POST',
            body: JSON.stringify(payload)
          });

          if (result.data?.student?.username) {
            state.teacherStudentSecrets[result.data.student.username] = payload.password;
          }

          const credentialsText = [
            `Institution ID: ${state.session.institutionId}`,
            `Username: ${result.data.student.username}`,
            `Temporary Password: ${payload.password}`
          ].join(' | ');
          status.textContent = `Student account created. ${credentialsText}`;
          showToast('Student account created.', 'success');
          try {
            await copyTextToClipboard(
              `LIFT Educations login\n${credentialsText.split(' | ').join('\n')}`
            );
            showToast('Student credentials copied.', 'info');
          } catch (error) {
            // no-op, status still contains credentials
          }
          void renderTeacherDashboard();
        } catch (error) {
          status.textContent = error.message;
          showToast(error.message, 'error');
        }
      });
    });
  }

  const searchInput = document.getElementById('teacherStudentSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      const nextValue = event.target.value;
      debounceByKey('teacher-student-search', () => {
        state.teacherStudentQuery = nextValue;
        void renderTeacherDashboard();
      });
    });
  }

  const subjectFilter = document.getElementById('teacherSubjectFilter');
  if (subjectFilter) {
    subjectFilter.addEventListener('change', (event) => {
      state.teacherSubjectFilter = event.target.value;
      void renderTeacherDashboard();
    });
  }

  const exportCsvBtn = document.getElementById('exportStudentsCsvBtn');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      downloadCsv(
        'students.csv',
        ['fullName', 'username', 'email', 'phone', 'subjects'],
        students.map((student) => ({
          fullName: student.fullName,
          username: student.username,
          email: student.email || '',
          phone: student.phone || '',
          subjects: (student.subjects || []).map((item) => item.name).join('; ')
        }))
      );
    });
  }

  document.querySelectorAll('[data-delete-student]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this student account?')) return;
      const studentId = button.getAttribute('data-delete-student');
      if (!studentId) return;

      await withButtonLoading(button, 'Deleting...', async () => {
        try {
          await api(`/teacher/students/${studentId}`, { method: 'DELETE' });
          showToast('Student deleted.', 'success');
          void renderTeacherDashboard();
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  });

  const classPlanDateInput = document.getElementById('teacherClassPlanDate');
  if (classPlanDateInput) {
    classPlanDateInput.addEventListener('change', (event) => {
      state.teacherClassPlanDate = event.target.value || todayIsoDate();
      void renderTeacherDashboard();
    });
  }

  const classPlanResourceType = document.getElementById('classPlanResourceType');
  if (classPlanResourceType) {
    classPlanResourceType.addEventListener('change', (event) => {
      state.teacherClassPlanResourceType = event.target.value || 'pdf';
      void renderTeacherDashboard();
    });
  }

  const createClassPlanBtn = document.getElementById('createClassPlanBtn');
  if (createClassPlanBtn) {
    createClassPlanBtn.addEventListener('click', async () => {
      const status = document.getElementById('createClassPlanStatus');
      const form = document.getElementById('createClassPlanForm');
      if (form && !form.reportValidity()) return;
      status.textContent = 'Saving class plan...';

      await withButtonLoading(createClassPlanBtn, 'Saving...', async () => {
        try {
          const subjectId = document.getElementById('classPlanSubjectId').value;
          const title = sanitizeValue(document.getElementById('classPlanTitle').value);
          const description = sanitizeValue(document.getElementById('classPlanDescription').value);
          const scheduledDate = document.getElementById('classPlanScheduledDate').value;
          const startTime = document.getElementById('classPlanStartTime').value;
          const endTime = document.getElementById('classPlanEndTime').value;

          const resourceType = state.teacherClassPlanResourceType;
          const resourceTitle = sanitizeValue(
            document.getElementById('classPlanResourceTitle')?.value || ''
          );
          const resourceKeywords = sanitizeValue(
            document.getElementById('classPlanResourceKeywords')?.value || ''
          );

          let resource = null;
          const classPlanResourceFile = document.getElementById('classPlanResourceFile')?.files?.[0] || null;
          const classPlanResourceValue = sanitizeValue(
            document.getElementById('classPlanResourceValue')?.value || ''
          );
          const hasResourceInput =
            Boolean(resourceTitle) || Boolean(classPlanResourceFile) || Boolean(classPlanResourceValue);

          if (hasResourceInput) {
            if (!resourceTitle) {
              status.textContent = 'Resource title is required if you attach a resource.';
              showToast(status.textContent, 'error');
              return;
            }

            if (resourceType === 'pdf' || resourceType === 'ebook') {
              if (!classPlanResourceFile) {
                status.textContent = 'Please upload a resource file.';
                showToast(status.textContent, 'error');
                return;
              }
              const uploadedResource = await uploadAsset(
                classPlanResourceFile,
                `resources/${resourceType}`
              );
              resource = {
                resourceType,
                title: resourceTitle,
                value: uploadedResource.url,
                source: 'file',
                keywords: resourceKeywords || classPlanResourceFile.name
              };
            } else {
              if (!classPlanResourceValue || !isHttpUrl(classPlanResourceValue)) {
                status.textContent = 'Please enter a valid resource URL.';
                showToast(status.textContent, 'error');
                return;
              }
              resource = {
                resourceType,
                title: resourceTitle,
                value: classPlanResourceValue,
                source: 'text',
                keywords: resourceKeywords || resourceTitle
              };
            }
          }

          await api('/teacher/class-plans', {
            method: 'POST',
            body: JSON.stringify({
              subjectId,
              title,
              description,
              scheduledDate,
              startTime,
              endTime,
              resource
            })
          });

          state.teacherClassPlanDate = scheduledDate || state.teacherClassPlanDate;
          status.textContent = 'Class plan saved successfully.';
          showToast('Class plan created.', 'success');
          void renderTeacherDashboard();
        } catch (error) {
          status.textContent = error.message;
          showToast(error.message, 'error');
        }
      });
    });
  }

  document.querySelectorAll('[data-delete-class-plan]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this class plan?')) return;
      const planId = button.getAttribute('data-delete-class-plan');
      if (!planId) return;

      await withButtonLoading(button, 'Deleting...', async () => {
        try {
          await api(`/teacher/class-plans/${planId}`, { method: 'DELETE' });
          showToast('Class plan deleted.', 'success');
          void renderTeacherDashboard();
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  });

  const createResourceBtn = document.getElementById('createResourceBtn');
  if (createResourceBtn) {
    createResourceBtn.addEventListener('click', async () => {
      const status = document.getElementById('createResourceStatus');
      const form = document.getElementById('createResourceForm');
      if (form && !form.reportValidity()) return;
      status.textContent = 'Uploading resource...';

      await withButtonLoading(createResourceBtn, 'Uploading...', async () => {
        try {
          const subjectId = document.getElementById('resourceSubjectId').value;
          const resourceType = document.getElementById('resourceType').value;
          const title = sanitizeValue(document.getElementById('resourceTitle').value);
          const keywordInput = sanitizeValue(document.getElementById('resourceKeywords').value);

          if (!subjectId) {
            status.textContent = 'Please choose a subject.';
            showToast(status.textContent, 'error');
            return;
          }
          if (!title) {
            status.textContent = 'Resource title is required.';
            showToast(status.textContent, 'error');
            return;
          }

          let payload;
          if (resourceType === 'pdf' || resourceType === 'ebook') {
            const file = document.getElementById('resourceFile')?.files?.[0] || null;
            if (!file) {
              status.textContent = 'Please upload a file for this resource type.';
              showToast(status.textContent, 'error');
              return;
            }

            payload = {
              subjectId,
              resourceType,
              title,
              value: (await uploadAsset(file, `resources/${resourceType}`)).url,
              source: 'file',
              keywords: keywordInput || file.name
            };
          } else {
            const value = sanitizeValue(document.getElementById('resourceValue')?.value || '');
            if (!value || !isHttpUrl(value)) {
              status.textContent = 'Please provide a valid URL.';
              showToast(status.textContent, 'error');
              return;
            }

            payload = {
              subjectId,
              resourceType,
              title,
              value,
              source: 'text',
              keywords: keywordInput || title
            };
          }

          await api('/teacher/resources', {
            method: 'POST',
            body: JSON.stringify(payload)
          });

          status.textContent = 'Resource uploaded.';
          showToast('Resource uploaded successfully.', 'success');
          void renderTeacherDashboard();
        } catch (error) {
          status.textContent = error.message;
          showToast(error.message, 'error');
        }
      });
    });
  }

  const resourceTypeInput = document.getElementById('resourceType');
  if (resourceTypeInput) {
    resourceTypeInput.addEventListener('change', (event) => {
      state.teacherResourceCreateType = event.target.value;
      void renderTeacherDashboard();
    });
  }

  const teacherResourceSearch = document.getElementById('teacherResourceSearch');
  if (teacherResourceSearch) {
    teacherResourceSearch.addEventListener('input', (event) => {
      const nextValue = event.target.value;
      debounceByKey('teacher-resource-search', () => {
        state.teacherResourceSearch = nextValue;
        void renderTeacherDashboard();
      });
    });
  }

  const teacherResourceType = document.getElementById('teacherResourceType');
  if (teacherResourceType) {
    teacherResourceType.addEventListener('change', (event) => {
      state.teacherResourceType = event.target.value;
      void renderTeacherDashboard();
    });
  }

  const teacherResourceSubject = document.getElementById('teacherResourceSubjectId');
  if (teacherResourceSubject) {
    teacherResourceSubject.addEventListener('change', (event) => {
      state.teacherResourceSubjectId = event.target.value;
      void renderTeacherDashboard();
    });
  }

  document.querySelectorAll('[data-delete-resource]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this resource?')) return;
      const resourceId = button.getAttribute('data-delete-resource');
      if (!resourceId) return;

      await withButtonLoading(button, 'Deleting...', async () => {
        try {
          await api(`/teacher/resources/${resourceId}`, { method: 'DELETE' });
          showToast('Resource deleted.', 'success');
          void renderTeacherDashboard();
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  });

  const testType = document.getElementById('testType');
  if (testType) {
    testType.addEventListener('change', (event) => {
      state.teacherTestType = event.target.value;
      if (state.teacherTestType !== 'pdf_upload') {
        state.teacherPdfPreview = null;
        state.teacherPdfPreviewBusy = false;
      }
      void renderTeacherDashboard();
    });
  }

  const mcqQuestionCount = document.getElementById('mcqQuestionCount');
  if (mcqQuestionCount) {
    const syncMcqCount = (value) => {
      const normalized = getValidMcqQuestionCount(value);
      state.teacherMcqQuestionCount = normalized == null ? '' : normalized;
      void renderTeacherDashboard();
    };
    mcqQuestionCount.addEventListener('change', (event) => {
      syncMcqCount(event.target.value);
    });
    mcqQuestionCount.addEventListener('input', (event) => {
      const normalized = getValidMcqQuestionCount(event.target.value);
      if (normalized == null && String(event.target.value || '').trim() !== '') return;
      syncMcqCount(event.target.value);
    });
  }

  const testDuration = document.getElementById('testDuration');
  if (testDuration) {
    testDuration.addEventListener('change', (event) => {
      const parsedValue = Number(event.target.value || 0);
      if (!Number.isFinite(parsedValue) || parsedValue <= 0) return;
      if (state.teacherTestType === 'mcq') {
        state.teacherMcqDurationMinutes = parsedValue;
      } else {
        state.teacherPdfDurationMinutes = parsedValue;
      }
    });
  }

  const mcqCorrectMarkInput = document.getElementById('mcqCorrectMark');
  if (mcqCorrectMarkInput) {
    mcqCorrectMarkInput.addEventListener('change', (event) => {
      const value = Number(event.target.value || '');
      if (!Number.isFinite(value) || value <= 0) return;
      state.teacherMcqCorrectMark = value;
    });
  }

  const mcqWrongMarkInput = document.getElementById('mcqWrongMark');
  if (mcqWrongMarkInput) {
    mcqWrongMarkInput.addEventListener('change', (event) => {
      const value = Number(event.target.value || '');
      if (!Number.isFinite(value)) return;
      state.teacherMcqWrongMark = value;
    });
  }

  const testSubject = document.getElementById('testSubjectId');
  if (testSubject) {
    testSubject.addEventListener('change', (event) => {
      state.teacherTestSubjectId = event.target.value || '';
      void renderTeacherDashboard();
    });
  }

  const testAudienceMode = document.getElementById('testAudienceMode');
  if (testAudienceMode) {
    testAudienceMode.addEventListener('change', (event) => {
      state.teacherTestAudienceMode = event.target.value || 'all';
      if (state.teacherTestAudienceMode === 'all') {
        state.teacherTestSelectedStudentIds = [];
      }
      void renderTeacherDashboard();
    });
  }

  const testScheduleEnabled = document.getElementById('testScheduleEnabled');
  if (testScheduleEnabled) {
    testScheduleEnabled.addEventListener('change', (event) => {
      state.teacherTestScheduleEnabled = Boolean(event.target.checked);
      void renderTeacherDashboard();
    });
  }

  const testScheduleDate = document.getElementById('testScheduleDate');
  if (testScheduleDate) {
    testScheduleDate.addEventListener('change', (event) => {
      state.teacherTestScheduleDate = event.target.value || todayIsoDate();
    });
  }

  const testScheduleStartTime = document.getElementById('testScheduleStartTime');
  if (testScheduleStartTime) {
    testScheduleStartTime.addEventListener('change', (event) => {
      state.teacherTestScheduleStartTime = event.target.value || '17:00';
    });
  }

  const testScheduleEndTime = document.getElementById('testScheduleEndTime');
  if (testScheduleEndTime) {
    testScheduleEndTime.addEventListener('change', (event) => {
      state.teacherTestScheduleEndTime = event.target.value || '19:00';
    });
  }

  document.querySelectorAll('[data-test-target-student]').forEach((input) => {
    input.addEventListener('change', () => {
      state.teacherTestSelectedStudentIds = Array.from(
        document.querySelectorAll('[data-test-target-student]:checked')
      )
        .map((item) => item.getAttribute('data-test-target-student'))
        .filter(Boolean);
    });
  });

  const selectAllTargetsBtn = document.getElementById('selectAllTargetsBtn');
  if (selectAllTargetsBtn) {
    selectAllTargetsBtn.addEventListener('click', () => {
      state.teacherTestSelectedStudentIds = checkedDataValues(
        '[data-test-target-student]',
        'data-test-target-student'
      );
      void renderTeacherDashboard();
    });
  }

  const clearTargetsBtn = document.getElementById('clearTargetsBtn');
  if (clearTargetsBtn) {
    clearTargetsBtn.addEventListener('click', () => {
      state.teacherTestSelectedStudentIds = [];
      void renderTeacherDashboard();
    });
  }

  const testPdfQuestionsFile = document.getElementById('testPdfQuestionsFile');
  if (testPdfQuestionsFile) {
    testPdfQuestionsFile.addEventListener('change', async () => {
      try {
        await refreshTeacherPdfPreview(true);
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  }

  const testPdfAnswerKeyFile = document.getElementById('testPdfAnswerKeyFile');
  if (testPdfAnswerKeyFile) {
    testPdfAnswerKeyFile.addEventListener('change', () => {
      if (state.teacherTestType === 'pdf_upload') renderTeacherPdfPreview();
    });
  }

  const previewPdfTestBtn = document.getElementById('previewPdfTestBtn');
  if (previewPdfTestBtn) {
    previewPdfTestBtn.addEventListener('click', async () => {
      await withButtonLoading(previewPdfTestBtn, 'Previewing...', async () => {
        try {
          await refreshTeacherPdfPreview(true);
          showToast('Teacher preview updated.', 'success');
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  }

  const createTestBtn = document.getElementById('createTestBtn');
  if (createTestBtn) {
    createTestBtn.addEventListener('click', async () => {
      const status = document.getElementById('createTestStatus');
      const form = document.getElementById('createTestForm');
      if (form && !form.reportValidity()) return;
      status.textContent = 'Publishing test...';

      await withButtonLoading(createTestBtn, 'Publishing...', async () => {
        try {
          const subjectId = document.getElementById('testSubjectId').value;
          const title = sanitizeValue(document.getElementById('testTitle').value);
          const selectedMode = document.getElementById('testType').value;
          const durationMinutes = Number(
            document.getElementById('testDuration').value ||
              (selectedMode === 'mcq' ? state.teacherMcqDurationMinutes : state.teacherPdfDurationMinutes)
          );
          const audienceMode = document.getElementById('testAudienceMode')?.value || 'all';
          const scheduleEnabled = Boolean(document.getElementById('testScheduleEnabled')?.checked);
          const selectedStudentIds =
            audienceMode === 'selected'
              ? Array.from(
                  new Set([
                    ...(state.teacherTestSelectedStudentIds || []),
                    ...checkedDataValues(
                      '[data-test-target-student]:checked',
                      'data-test-target-student'
                    )
                  ])
                )
              : [];

          if (!subjectId || !title) {
            status.textContent = 'Subject and title are required.';
            showToast(status.textContent, 'error');
            return;
          }

          if (audienceMode === 'selected' && !selectedStudentIds.length) {
            status.textContent = 'Select at least one student for selected audience mode.';
            showToast(status.textContent, 'error');
            return;
          }

          if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
            status.textContent = 'Please choose a valid duration.';
            showToast(status.textContent, 'error');
            return;
          }

          let type = selectedMode;
          let sourcePdfName = '';
          let questions = [];
          let scheduledStartAt = '';
          let scheduledEndAt = '';
          let questionPdfUrl = '';
          let questionPdfName = '';
          let answerKeyPdfUrl = '';
          let answerKeyPdfName = '';

          if (scheduleEnabled) {
            const dateValue = document.getElementById('testScheduleDate')?.value || '';
            const startTime = document.getElementById('testScheduleStartTime')?.value || '';
            const endTime = document.getElementById('testScheduleEndTime')?.value || '';

            state.teacherTestScheduleDate = dateValue || state.teacherTestScheduleDate;
            state.teacherTestScheduleStartTime = startTime || state.teacherTestScheduleStartTime;
            state.teacherTestScheduleEndTime = endTime || state.teacherTestScheduleEndTime;

            scheduledStartAt = combineDateAndTimeToIso(dateValue, startTime);
            scheduledEndAt = combineDateAndTimeToIso(dateValue, endTime);
            if (!scheduledStartAt || !scheduledEndAt) {
              status.textContent = 'Please enter valid schedule date/time.';
              showToast(status.textContent, 'error');
              return;
            }
            if (new Date(scheduledEndAt).getTime() <= new Date(scheduledStartAt).getTime()) {
              status.textContent = 'Schedule end time must be after start time.';
              showToast(status.textContent, 'error');
              return;
            }
          }

          if (selectedMode === 'mcq') {
            const rawCount = document.getElementById('mcqQuestionCount')?.value ?? state.teacherMcqQuestionCount;
            const questionCount = getValidMcqQuestionCount(rawCount);
            if (questionCount == null) {
              status.textContent = `Choose MCQ question count between ${MCQ_MIN_QUESTION_COUNT} and ${MCQ_MAX_QUESTION_COUNT}.`;
              showToast(status.textContent, 'error');
              return;
            }
            state.teacherMcqQuestionCount = questionCount;
            state.teacherMcqDurationMinutes = durationMinutes;
            const correctMark = Number(
              document.getElementById('mcqCorrectMark')?.value ?? state.teacherMcqCorrectMark
            );
            const wrongMark = Number(
              document.getElementById('mcqWrongMark')?.value ?? state.teacherMcqWrongMark
            );
            if (!Number.isFinite(correctMark) || correctMark <= 0) {
              status.textContent = 'Right-answer mark must be greater than 0.';
              showToast(status.textContent, 'error');
              return;
            }
            if (!Number.isFinite(wrongMark) || wrongMark > 0) {
              status.textContent = 'Wrong-answer mark must be 0 or negative.';
              showToast(status.textContent, 'error');
              return;
            }
            state.teacherMcqCorrectMark = correctMark;
            state.teacherMcqWrongMark = wrongMark;
            questions = collectObjectiveQuestions(questionCount);
          } else if (selectedMode === 'pdf_upload') {
            state.teacherPdfDurationMinutes = durationMinutes;
            const questionPdfInput = document.getElementById('testPdfQuestionsFile');
            const answerKeyPdfInput = document.getElementById('testPdfAnswerKeyFile');
            const questionPdfFile = questionPdfInput?.files?.[0];
            const answerKeyPdfFile = answerKeyPdfInput?.files?.[0];
            if (!questionPdfFile) {
              status.textContent = 'Please upload the Questions PDF.';
              showToast(status.textContent, 'error');
              return;
            }
            if (!answerKeyPdfFile) {
              status.textContent = 'Please upload the Answer Key PDF.';
              showToast(status.textContent, 'error');
              return;
            }

            const fileSignature = getFileSignature(questionPdfFile);
            let previewResult = state.teacherPdfPreview;
            if (
              !previewResult ||
              previewResult.error ||
              previewResult.fileSignature !== fileSignature ||
              !Array.isArray(previewResult.questions) ||
              !previewResult.questions.length
            ) {
              status.textContent = 'Extracting questions from PDF...';
              previewResult = await refreshTeacherPdfPreview(true);
            }

            questions = Array.isArray(previewResult?.questions) ? previewResult.questions : [];
            if (!questions.length) {
              status.textContent = 'Could not extract questions from the uploaded PDF.';
              showToast(status.textContent, 'error');
              return;
            }

            status.textContent = 'Uploading Questions PDF...';
            const uploadedQuestionsPdf = await uploadAsset(questionPdfFile, 'tests/questions');
            status.textContent = 'Uploading Answer Key PDF...';
            const uploadedAnswerKeyPdf = await uploadAsset(answerKeyPdfFile, 'tests/answer-keys');
            type = 'long';
            sourcePdfName = questionPdfFile?.name || '';
            questionPdfUrl = uploadedQuestionsPdf.url;
            questionPdfName = questionPdfFile.name || '';
            answerKeyPdfUrl = uploadedAnswerKeyPdf.url;
            answerKeyPdfName = answerKeyPdfFile.name || '';
          } else {
            status.textContent = 'Unsupported test mode.';
            showToast(status.textContent, 'error');
            return;
          }

          const payload = {
            subjectId,
            title,
            type,
            durationMinutes,
            mcqCorrectMark:
              type === 'mcq'
                ? Number(state.teacherMcqCorrectMark || 1)
                : undefined,
            mcqWrongMark:
              type === 'mcq'
                ? Number(state.teacherMcqWrongMark || 0)
                : undefined,
            audienceMode,
            selectedStudentIds,
            sourcePdfName,
            questionPdfUrl,
            questionPdfName,
            answerKeyPdfUrl,
            answerKeyPdfName,
            scheduledStartAt,
            scheduledEndAt,
            questions
          };

          await api('/teacher/tests', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          status.textContent = 'Test published.';
          showToast('Test published successfully.', 'success');
          void renderTeacherDashboard();
        } catch (error) {
          status.textContent = error.message;
          showToast(error.message, 'error');
        }
      });
    });
  }

  document.querySelectorAll('[data-view-test]').forEach((button) => {
    button.addEventListener('click', () => {
      state.teacherViewedTestId = button.getAttribute('data-view-test') || '';
      state.teacherReconductDraft = null;
      void renderTeacherDashboard();
    });
  });

  document.querySelectorAll('[data-edit-reconduct-test]').forEach((button) => {
    button.addEventListener('click', () => {
      const testId = button.getAttribute('data-edit-reconduct-test');
      const sourceTest = tests.find((test) => test._id === testId);
      if (!sourceTest) return;
      if (sourceTest.type !== 'mcq') {
        showToast('Edit & Re-conduct is available for MCQ tests only.', 'error');
        return;
      }
      state.teacherViewedTestId = '';
      state.teacherReconductDraft = buildReconductDraftFromTest(sourceTest);
      void renderTeacherDashboard();
    });
  });

  document.querySelectorAll('[data-close-view-test]').forEach((button) => {
    button.addEventListener('click', () => {
      state.teacherViewedTestId = '';
      void renderTeacherDashboard();
    });
  });

  document.querySelectorAll('[data-close-reconduct-test]').forEach((button) => {
    button.addEventListener('click', () => {
      state.teacherReconductDraft = null;
      void renderTeacherDashboard();
    });
  });

  const reconductAudienceMode = document.getElementById('reconductAudienceMode');
  if (reconductAudienceMode && state.teacherReconductDraft) {
    reconductAudienceMode.addEventListener('change', (event) => {
      state.teacherReconductDraft.audienceMode = event.target.value === 'all' ? 'all' : 'selected';
      if (state.teacherReconductDraft.audienceMode === 'all') {
        state.teacherReconductDraft.selectedStudentIds = [];
      }
      void renderTeacherDashboard();
    });
  }

  document.querySelectorAll('[data-reconduct-student]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      if (!state.teacherReconductDraft) return;
      state.teacherReconductDraft.selectedStudentIds = Array.from(
        document.querySelectorAll('[data-reconduct-student]:checked')
      )
        .map((item) => item.getAttribute('data-reconduct-student'))
        .filter(Boolean);
    });
  });

  const reconductSelectAllBtn = document.getElementById('reconductSelectAllBtn');
  if (reconductSelectAllBtn && state.teacherReconductDraft) {
    reconductSelectAllBtn.addEventListener('click', () => {
      state.teacherReconductDraft.selectedStudentIds = reconductStudentPool
        .map((student) => resolveEntityId(student))
        .filter(Boolean);
      void renderTeacherDashboard();
    });
  }

  const reconductClearAllBtn = document.getElementById('reconductClearAllBtn');
  if (reconductClearAllBtn && state.teacherReconductDraft) {
    reconductClearAllBtn.addEventListener('click', () => {
      state.teacherReconductDraft.selectedStudentIds = [];
      void renderTeacherDashboard();
    });
  }

  const publishReconductBtn = document.getElementById('publishReconductBtn');
  if (publishReconductBtn && state.teacherReconductDraft) {
    publishReconductBtn.addEventListener('click', async () => {
      const status = document.getElementById('reconductStatus');
      if (status) status.textContent = 'Publishing...';

      await withButtonLoading(publishReconductBtn, 'Publishing...', async () => {
        try {
          if (!state.teacherReconductDraft) return;
          const draft = state.teacherReconductDraft;
          const title = sanitizeValue(document.getElementById('reconductTitle')?.value || '');
          const durationMinutes = Number(document.getElementById('reconductDuration')?.value || 0);
          const mcqCorrectMark = Number(document.getElementById('reconductCorrectMark')?.value || 0);
          const mcqWrongMark = Number(document.getElementById('reconductWrongMark')?.value || 0);

          if (title.length < 2) throw new Error('Test title must be at least 2 characters.');
          if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 180) {
            throw new Error('Duration must be between 1 and 180 minutes.');
          }
          if (!Number.isFinite(mcqCorrectMark) || mcqCorrectMark <= 0) {
            throw new Error('Right-answer mark must be greater than 0.');
          }
          if (!Number.isFinite(mcqWrongMark) || mcqWrongMark > 0) {
            throw new Error('Wrong-answer mark must be 0 or negative.');
          }

          const audienceMode =
            (document.getElementById('reconductAudienceMode')?.value || draft.audienceMode) === 'all'
              ? 'all'
              : 'selected';
          const selectedStudentIds =
            audienceMode === 'selected'
              ? Array.from(
                  new Set([
                    ...(state.teacherReconductDraft?.selectedStudentIds || []),
                    ...checkedDataValues(
                      '[data-reconduct-student]:checked',
                      'data-reconduct-student'
                    )
                  ])
                )
              : [];

          if (audienceMode === 'selected' && !selectedStudentIds.length) {
            throw new Error('Select at least one student for selected audience mode.');
          }

          const questions = collectReconductQuestionsFromDom((draft.questions || []).length);

          await api('/teacher/tests', {
            method: 'POST',
            body: JSON.stringify({
              subjectId: draft.subjectId,
              title,
              type: 'mcq',
              durationMinutes,
              mcqCorrectMark,
              mcqWrongMark,
              audienceMode,
              selectedStudentIds,
              questions
            })
          });

          showToast('Edited test re-conducted successfully.', 'success');
          state.teacherReconductDraft = null;
          await renderTeacherDashboard();
        } catch (error) {
          if (status) status.textContent = error.message || 'Failed to re-conduct test.';
          showToast(error.message || 'Failed to re-conduct test.', 'error');
        }
      });
    });
  }

  document.querySelectorAll('[data-download-viewed-questions]').forEach((button) => {
    button.addEventListener('click', async () => {
      const testId = button.getAttribute('data-download-viewed-questions');
      const test = tests.find((item) => item._id === testId);
      if (!test) return;

      await withButtonLoading(button, 'Preparing...', async () => {
        try {
          if (test.type === 'long' && test.questionPdfUrl) {
            const link = document.createElement('a');
            link.href = test.questionPdfUrl;
            link.target = '_blank';
            link.rel = 'noreferrer';
            link.download = test.questionPdfName || `${test.title || 'test'}-questions.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            showToast('Questions PDF downloaded.', 'success');
            return;
          }

          saveTextAsPdf(
            `${String(test.title || 'mcq-test').replace(/\s+/g, '-').toLowerCase()}-questions.pdf`,
            buildMcqQuestionsPdfLines(test)
          );
          showToast('Questions PDF downloaded.', 'success');
        } catch (error) {
          showToast(error.message || 'Failed to download questions PDF.', 'error');
        }
      });
    });
  });

  document.querySelectorAll('[data-download-viewed-answer-key]').forEach((button) => {
    button.addEventListener('click', async () => {
      const testId = button.getAttribute('data-download-viewed-answer-key');
      const test = tests.find((item) => item._id === testId);
      if (!test) return;

      await withButtonLoading(button, 'Preparing...', async () => {
        try {
          if (test.type === 'long' && test.answerKeyPdfUrl) {
            const link = document.createElement('a');
            link.href = test.answerKeyPdfUrl;
            link.target = '_blank';
            link.rel = 'noreferrer';
            link.download = test.answerKeyPdfName || `${test.title || 'test'}-answer-key.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            showToast('Answer key PDF downloaded.', 'success');
            return;
          }

          saveTextAsPdf(
            `${String(test.title || 'mcq-test').replace(/\s+/g, '-').toLowerCase()}-answer-key.pdf`,
            buildMcqAnswerKeyPdfLines(test)
          );
          showToast('Answer key PDF downloaded.', 'success');
        } catch (error) {
          showToast(error.message || 'Failed to download answer key PDF.', 'error');
        }
      });
    });
  });

  document.querySelectorAll('[data-download-viewed-combined]').forEach((button) => {
    button.addEventListener('click', async () => {
      const testId = button.getAttribute('data-download-viewed-combined');
      const test = tests.find((item) => item._id === testId);
      if (!test) return;

      await withButtonLoading(button, 'Preparing...', async () => {
        try {
          saveTextAsPdf(
            `${String(test.title || 'mcq-test').replace(/\s+/g, '-').toLowerCase()}-test-pack.pdf`,
            buildMcqCombinedPdfLines(test)
          );
          showToast('Combined test PDF downloaded.', 'success');
        } catch (error) {
          showToast(error.message || 'Failed to download combined test PDF.', 'error');
        }
      });
    });
  });

  const teacherAssessmentQuery = document.getElementById('teacherAssessmentQuery');
  if (teacherAssessmentQuery) {
    teacherAssessmentQuery.addEventListener('input', (event) => {
      const nextValue = event.target.value;
      debounceByKey('teacher-assessment-search', () => {
        state.teacherAssessmentQuery = nextValue;
        void renderTeacherDashboard();
      });
    });
  }

  const teacherAssessmentSubject = document.getElementById('teacherAssessmentSubjectId');
  if (teacherAssessmentSubject) {
    teacherAssessmentSubject.addEventListener('change', (event) => {
      state.teacherAssessmentSubjectId = event.target.value || '';
      void renderTeacherDashboard();
    });
  }

  const teacherAssessmentType = document.getElementById('teacherAssessmentType');
  if (teacherAssessmentType) {
    teacherAssessmentType.addEventListener('change', (event) => {
      state.teacherAssessmentType = event.target.value || '';
      void renderTeacherDashboard();
    });
  }

  const teacherAssessmentStatus = document.getElementById('teacherAssessmentStatus');
  if (teacherAssessmentStatus) {
    teacherAssessmentStatus.addEventListener('change', (event) => {
      state.teacherAssessmentStatus = event.target.value || 'pending';
      void renderTeacherDashboard();
    });
  }

  document.querySelectorAll('[data-grade-attempt]').forEach((button) => {
    button.addEventListener('click', async () => {
      const attemptId = button.getAttribute('data-grade-attempt');
      const marksInputId = button.getAttribute('data-grade-input');
      const feedbackInputId = button.getAttribute('data-feedback-input');
      if (!attemptId || !marksInputId) return;

      const marksInput = document.getElementById(marksInputId);
      const feedbackInput = feedbackInputId ? document.getElementById(feedbackInputId) : null;
      const marks = Number(String(marksInput?.value || '').trim());
      const feedback = sanitizeValue(feedbackInput?.value || '');

      if (!Number.isFinite(marks) || marks < 0 || marks > 100) {
        showToast('Marks must be between 0 and 100.', 'error');
        return;
      }

      await withButtonLoading(button, 'Saving...', async () => {
        try {
          await api(`/teacher/assessments/${attemptId}/grade`, {
            method: 'PATCH',
            body: JSON.stringify({ marks, feedback })
          });
          showToast('Assessment saved.', 'success');
          void renderTeacherDashboard();
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  });

  bindAccountPasswordForm();
  endNavTransition();
}

function renderStudentAttemptResult(test, attempt, backTab) {
  clearAttemptTimer();

  const scoreText =
    attempt.scorePercent == null
      ? 'Submitted'
      : `${attempt.scorePercent}% (${attempt.correctCount}/${attempt.totalQuestions})`;

  app.innerHTML = `
    <div class="dashboard-shell">
      <header class="main-nav">
        <div class="left-nav">
          ${logoMarkup(true)}
          <span class="nav-pill active">Test Result</span>
        </div>
        <button class="signout" id="backToStudentDashboardBtn">Back</button>
      </header>

      <main class="page container-xl">
        <section class="panel">
          <h2>${escapeHtml(test.title)}</h2>
          <p class="subline">${escapeHtml(formatTestType(test.type))} | ${escapeHtml(test.subjectName || '')}</p>
          <p class="headline">${scoreText}</p>
          <p class="muted">Time spent: ${Math.round((attempt.timeSpentSeconds || 0) / 60)} minutes</p>

          ${
            test.type === 'mcq' || test.hasAnswerKey
              ? '<button class="cta-soft" id="viewAnswerKeyBtn">View Answer Key</button>'
              : ''
          }
        </section>
      </main>
    </div>
  `;

  document.getElementById('backToStudentDashboardBtn').addEventListener('click', () => {
    state.studentTab = backTab || 'history';
    void renderStudentDashboard();
  });

  const answerKeyBtn = document.getElementById('viewAnswerKeyBtn');
  if (answerKeyBtn) {
    answerKeyBtn.addEventListener('click', async () => {
      await withButtonLoading(answerKeyBtn, 'Opening...', async () => {
        try {
          const result = await api(`/student/tests/attempts/${attempt._id}/answer-key`);
          openStudentAnswerKeyViewer(result.data, `${test.title || 'Test'} - Answer Key`);
          showToast('Answer key opened.', 'success');
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  }
}

function renderStudentTestAttempt(test, backTab) {
  clearAttemptTimer();

  const durationSeconds = Number(test.durationMinutes || 5) * 60;
  const startedAt = Date.now();
  let remainingSeconds = durationSeconds;

  const questionMarkup = (test.questions || [])
    .map((question, index) => {
      const hasOptions = Array.isArray(question.options) && question.options.length >= 2;

      if (test.type === 'mcq' || hasOptions) {
        const options = (question.options || [])
          .map(
            (option, optionIndex) => `
              <label class="option-row">
                <input type="radio" name="q-${index}" value="${optionIndex}" />
                <span>${escapeHtml(option)}</span>
              </label>
            `
          )
          .join('');

        return `
          <article class="question-card">
            <h3>Q${index + 1}. ${escapeHtml(question.text)}</h3>
            <div class="options-list">${options}</div>
          </article>
        `;
      }

      return `
        <article class="question-card">
          <h3>Q${index + 1}. ${escapeHtml(question.text)}</h3>
          <textarea id="long-answer-${index}" rows="4" placeholder="Write your answer"></textarea>
        </article>
      `;
    })
    .join('');

  app.innerHTML = `
    <div class="dashboard-shell">
      <header class="main-nav">
        <div class="left-nav">
          ${logoMarkup(true)}
          <span class="nav-pill active">${escapeHtml(formatTestType(test.type))} Attempt</span>
        </div>
        <span class="timer-pill" id="studentAttemptTimer">Time Left: --:--</span>
      </header>

      <main class="page container-xl">
        <section class="panel">
          <h2>${escapeHtml(test.title)}</h2>
          <p class="subline">${escapeHtml(test.subjectName || '')} | ${escapeHtml(test.durationMinutes)} minutes</p>
          ${
            test.scheduledStartAt && test.scheduledEndAt
              ? `<p class="muted">Allowed window: ${escapeHtml(formatTestWindow(test))}</p>`
              : ''
          }
          <p class="muted">This test is completed inside the system. The original uploaded PDF is not shown to students.</p>
        </section>

        <section class="panel">
          <div class="mcq-list">${questionMarkup}</div>
          <button class="cta-main" id="submitStudentAttemptBtn">Submit Test</button>
          <p class="auth-note" id="studentAttemptStatus"></p>
        </section>
      </main>
    </div>
  `;

  const timerNode = document.getElementById('studentAttemptTimer');
  const statusNode = document.getElementById('studentAttemptStatus');

  const updateTimer = () => {
    const mins = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
    const secs = String(remainingSeconds % 60).padStart(2, '0');
    timerNode.textContent = `Time Left: ${mins}:${secs}`;
    if (remainingSeconds <= 0) {
      clearAttemptTimer();
      void submitAttempt(true);
      return;
    }
    remainingSeconds -= 1;
  };

  const submitAttempt = async (timeExpired = false) => {
    if (runtime.attemptSubmitting) return;
    runtime.attemptSubmitting = true;

    const answers = (test.questions || []).map((_, index) => {
      const question = test.questions?.[index] || {};
      const hasOptions = Array.isArray(question.options) && question.options.length >= 2;
      if (test.type === 'mcq' || hasOptions) {
        const checked = document.querySelector(`input[name=\"q-${index}\"]:checked`);
        return checked ? Number(checked.value) : null;
      }
      return document.getElementById(`long-answer-${index}`)?.value || '';
    });

    const spent = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    statusNode.textContent = timeExpired ? 'Time finished. Submitting...' : 'Submitting...';

    try {
      const result = await api(`/student/tests/${test._id}/attempt`, {
        method: 'POST',
        body: JSON.stringify({
          answers,
          timeSpentSeconds: spent
        })
      });

      renderStudentAttemptResult(test, result.data.attempt, backTab);
    } catch (error) {
      runtime.attemptSubmitting = false;
      statusNode.textContent = error.message;
    }
  };

  document.getElementById('submitStudentAttemptBtn').addEventListener('click', () => {
    clearAttemptTimer();
    void submitAttempt(false);
  });

  updateTimer();
  runtime.attemptTimerId = setInterval(updateTimer, 1000);
}

function isStudentPdfResource(resource) {
  const type = String(resource?.resourceType || '').toLowerCase();
  if (type === 'pdf' || type === 'ebook') return true;
  const value = String(resource?.value || '').trim().toLowerCase();
  return value.endsWith('.pdf') || value.includes('.pdf?');
}

function buildStudentPdfViewerSrc(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  const hashParams = 'toolbar=0&navpanes=0&scrollbar=0&view=FitH';
  return value.includes('#') ? `${value}&${hashParams}` : `${value}#${hashParams}`;
}

function answerKeyViewerMarkup(payload, title = 'Answer Key') {
  if (!payload) return '';
  const safeTitle = escapeHtml(title);
  const viewUrl = String(payload.viewUrl || '').trim();

  if (viewUrl) {
    return `
      <div class="test-modal-backdrop" data-close-student-answer-key></div>
      <section class="test-modal" role="dialog" aria-modal="true" aria-label="Answer Key Viewer">
        <div class="test-modal-card">
          <div class="progress-row">
            <h3>${safeTitle}</h3>
            <button class="mini-btn" type="button" data-close-student-answer-key>Close</button>
          </div>
          <p class="muted">View-only mode. Download is disabled in this interface.</p>
          <p class="muted" id="studentAnswerKeyStatus">Loading PDF...</p>
          <div class="pdf-viewer resource-pdf-viewer student-pdf-canvas-root" id="studentAnswerKeyCanvasRoot"></div>
        </div>
      </section>
    `;
  }

  const rows = Array.isArray(payload.answerKey) ? payload.answerKey : [];
  return `
    <div class="test-modal-backdrop" data-close-student-answer-key></div>
    <section class="test-modal" role="dialog" aria-modal="true" aria-label="Answer Key Viewer">
      <div class="test-modal-card">
        <div class="progress-row">
          <h3>${safeTitle}</h3>
          <button class="mini-btn" type="button" data-close-student-answer-key>Close</button>
        </div>
        <p class="muted">View-only mode. Download is disabled in this interface.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Question</th>
                <th>Correct Answer</th>
              </tr>
            </thead>
            <tbody>
              ${
                rows.length
                  ? rows
                      .map(
                        (item) => `
                          <tr>
                            <td>${escapeHtml(item.questionNumber ?? '-')}</td>
                            <td>${escapeHtml(item.question || '-')}</td>
                            <td>${escapeHtml(item.correctAnswer || '-')}</td>
                          </tr>
                        `
                      )
                      .join('')
                  : '<tr><td colspan="3">Answer key is not available.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function bindStudentAnswerKeyViewerEvents() {
  document.querySelectorAll('[data-close-student-answer-key]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-student-answer-key-root]').forEach((node) => node.remove());
    });
  });
}

function openStudentAnswerKeyViewer(payload, title = 'Answer Key') {
  document.querySelectorAll('[data-student-answer-key-root]').forEach((node) => node.remove());
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-student-answer-key-root', '1');
  wrapper.innerHTML = answerKeyViewerMarkup(payload, title);
  document.body.appendChild(wrapper);
  bindStudentAnswerKeyViewerEvents();
  if (payload?.viewUrl) {
    void renderProtectedPdfInto(payload.viewUrl, 'studentAnswerKeyCanvasRoot', 'studentAnswerKeyStatus');
  }
}

async function renderStudentProtectedPdfDocument(url) {
  return renderProtectedPdfInto(url, 'studentPdfCanvasRoot', 'studentPdfStatus');
}

async function renderProtectedPdfInto(url, containerId, statusId) {
  const container = document.getElementById(containerId);
  const status = document.getElementById(statusId);
  if (!container || !status) return;

  container.innerHTML = '';
  status.textContent = 'Loading PDF...';

  if (!window.pdfjsLib?.getDocument) {
    status.textContent = 'PDF viewer is unavailable in this browser.';
    return;
  }

  try {
    const rawUrl = String(url || '').trim();
    const requestUrl = rawUrl.startsWith('/api/')
      ? `${await resolveApiBase()}${rawUrl.slice(4)}`
      : rawUrl;

    const response = await fetch(requestUrl, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    });
    if (!response.ok) {
      throw new Error('Unable to open PDF.');
    }

    const pdfBytes = new Uint8Array(await response.arrayBuffer());
    const pdf = await window.pdfjsLib.getDocument({ data: pdfBytes }).promise;
    status.textContent = `${pdf.numPages} page(s) loaded`;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const targetWidth = Math.max(320, (container.clientWidth || 760) - 24);
      const scale = Math.min(1.5, Math.max(0.9, targetWidth / baseViewport.width));
      const viewport = page.getViewport({ scale });
      const pageShell = document.createElement('section');
      pageShell.className = 'student-pdf-page';
      const label = document.createElement('p');
      label.className = 'student-pdf-page-label';
      label.textContent = `Page ${pageNumber}`;
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      pageShell.appendChild(label);
      pageShell.appendChild(canvas);
      container.appendChild(pageShell);

      const context = canvas.getContext('2d');
      if (!context) continue;
      await page.render({
        canvasContext: context,
        viewport
      }).promise;
    }
  } catch (error) {
    status.textContent = error.message || 'Unable to render PDF.';
  }
}

function studentResourceActionMarkup(resource) {
  if (!resource) return '<span class="muted">No file</span>';
  if (isStudentPdfResource(resource) && resource.viewUrl) {
    return `
      <button
        type="button"
        class="mini-btn"
        data-open-student-pdf="1"
        data-pdf-url="${escapeHtml(resource.viewUrl)}"
        data-pdf-title="${escapeHtml(resource.title || 'PDF Resource')}"
      >
        View File
      </button>
    `;
  }

  if (!resource.value) return '<span class="muted">No file</span>';
  return `<a href="${escapeHtml(resource.value)}" target="_blank" rel="noreferrer">Open Link</a>`;
}

function studentClassResourceMarkup(resource) {
  if (!resource) return '<span class="muted">No file</span>';

  const safeId = String(resource.id || resource._id || '').trim();
  const safeType = String(resource.resourceType || '').toLowerCase();
  const protectedViewUrl =
    (isStudentPdfResource(resource) && String(resource.viewUrl || '').trim()) ||
    (safeId && (safeType === 'pdf' || safeType === 'ebook')
      ? `/api/student/resources/${safeId}/view`
      : '');

  if (protectedViewUrl) {
    return `
      <div class="class-resource-block">
        <p><strong>${escapeHtml(resource.title || 'Attached file')}</strong></p>
        <button
          type="button"
        class="mini-btn"
        data-open-student-pdf="1"
        data-pdf-url="${escapeHtml(protectedViewUrl)}"
        data-pdf-title="${escapeHtml(resource.title || 'Class Resource')}"
      >
          View File
        </button>
      </div>
    `;
  }

  if (String(resource.value || '').trim()) {
    return `
      <div class="class-resource-block">
        <p><strong>${escapeHtml(resource.title || 'Attached resource')}</strong></p>
        <a href="${escapeHtml(resource.value)}" target="_blank" rel="noreferrer">Open Link</a>
      </div>
    `;
  }

  return '<span class="muted">No file</span>';
}

function resourcesGroupedMarkup(resources) {
  const groups = {
    pdf: [],
    ebook: [],
    video: [],
    link: []
  };

  resources.forEach((resource) => {
    const key = resource.resourceType;
    if (!groups[key]) groups[key] = [];
    groups[key].push(resource);
  });

  const section = (type, label) => {
    const list = groups[type] || [];
    return `
      <section class="resource-section">
        <h4>${label}</h4>
        ${
          list.length
            ? list
                .map(
                  (item) => `
                    <article class="resource-card modern ${escapeHtml(item.resourceType)}">
                      <div class="resource-thumb ${escapeHtml(item.resourceType)}">${escapeHtml(item.resourceType.toUpperCase())}</div>
                      <div class="resource-body">
                        <p><strong>${escapeHtml(item.title)}</strong></p>
                        <p class="muted">${escapeHtml(item.subjectName || '')} | ${escapeHtml(item.teacherName || '')}</p>
                        ${studentResourceActionMarkup(item)}
                      </div>
                    </article>
                  `
                )
                .join('')
            : '<p class="muted">No resources in this section.</p>'
        }
      </section>
    `;
  };

  return `${section('pdf', 'PDFs')}${section('ebook', 'EBooks')}${section('video', 'Videos')}${section('link', 'Links')}`;
}

function levelProgressPercent(xp = 0) {
  const safeXp = Math.max(0, Number(xp || 0));
  const remainder = safeXp % 120;
  return Math.round((remainder / 120) * 100);
}

async function renderStudentDashboard() {
  clearAttemptTimer();
  beginNavTransition();

  const user = state.session?.user || { fullName: '', username: '' };
  const institutionId = state.session?.institutionId || '';

  const shouldLoadDashboard = state.studentTab === 'dashboard' || state.studentTab === 'resources' || state.studentTab === 'syllabus';
  const shouldLoadHistory = state.studentTab === 'history';
  const shouldLoadQueue =
    state.studentTab === 'dashboard' ||
    state.studentTab === 'today' ||
    state.studentTab === 'pending';
  const shouldLoadTodayClasses = state.studentTab === 'dashboard' || state.studentTab === 'classes';

  const [dashboardResult, historyResult, queueResult, todayClassesResult] = await Promise.all([
    shouldLoadDashboard ? api('/student/dashboard') : Promise.resolve({ data: { dashboard: { subjects: [], streakDays: 0, level: 1, xp: 0, badges: [] } } }),
    shouldLoadHistory ? api('/student/tests/history') : Promise.resolve({ data: { history: [] } }),
    shouldLoadQueue ? api('/student/tests/queue') : Promise.resolve({ data: { today: [], pending: [] } }),
    shouldLoadTodayClasses ? api('/student/classes/today') : Promise.resolve({ data: { classes: [] } })
  ]);

  schedulePrefetch(
    ['/student/dashboard', '/student/tests/queue', '/student/resources', '/student/syllabus', '/student/classes/today', '/student/tests/history'],
    'student-core'
  );
  const dashboard = dashboardResult.data.dashboard;
  const history = historyResult.data.history || [];
  const todayTests = queueResult.data.today || [];
  const pendingTests = queueResult.data.pending || [];
  const todayClasses = todayClassesResult.data.classes || [];

  const subjects = dashboard.subjects || [];
  const allowedStudentTabs = new Set([
    'dashboard',
    'today',
    'pending',
    'classes',
    'resources',
    'syllabus',
    'history',
    'planner',
    'accounts'
  ]);
  if (!allowedStudentTabs.has(state.studentTab)) {
    state.studentTab = 'dashboard';
  }

  const todoItems = loadStudentTodos(user.id || user._id);
  const pendingTodos = todoItems.filter((item) => !item.completed);
  const completedTodos = todoItems.filter((item) => item.completed);

  let resources = [];
  if (state.studentTab === 'resources') {
    const resourceQuery = toQueryString({
      q: state.studentResourceSearch,
      resourceType: state.studentResourceType,
      subjectId: state.studentResourceSubjectId
    });
    const resourceResult = await api(`/student/resources${resourceQuery}`);
    resources = resourceResult.data.resources || [];
  }

  let syllabi = [];
  if (state.studentTab === 'syllabus') {
    const syllabusResult = await api('/student/syllabus');
    syllabi = syllabusResult.data.syllabi || [];
  }

  const testMap = new Map([...todayTests, ...pendingTests].map((test) => [test._id, test]));

  app.innerHTML = `
    <div class="dashboard-shell">
      <header class="main-nav">
        <div class="left-nav">
          ${logoMarkup(true)}
          ${studentNavMarkup(state.studentTab)}
        </div>
        <div class="top-actions">
          <button class="signout" id="logoutBtn">Sign Out</button>
        </div>
      </header>

      <main class="page container-xl">
        <h2>Good Day, ${escapeHtml(user.fullName)} 👋</h2>
        <p class="subline">Institution ID: ${escapeHtml(institutionId)}</p>
        ${smokeReportMarkup(state.qaReports.student)}

        ${
          state.studentTab === 'dashboard'
            ? `
              <section class="alert-card">
                <div>
                  <h3>${pendingTests.length} tests are overdue</h3>
                  <p>Please complete pending tests to stay on track.</p>
                </div>
                <span class="alert-tag">Backlog</span>
              </section>

              <section class="two-grid">
                <article class="panel">
                  <h3>Today's Test</h3>
                  <p class="headline">${todayTests.length ? escapeHtml(todayTests[0].title) : 'No test published yet'}</p>
                  <p class="muted">${todayTests.length ? `${escapeHtml(formatTestType(todayTests[0].type))} | ${escapeHtml(todayTests[0].durationMinutes)} min` : 'Please check later.'}</p>
                  ${
                    todayTests.length && (todayTests[0].scheduledStartAt || todayTests[0].scheduledEndAt)
                      ? `<p class="muted">Window: ${escapeHtml(formatTestWindow(todayTests[0]))}</p>`
                      : ''
                  }
                  <button class="cta-main" data-student-nav="today">Open Today's Tests</button>
                </article>

                <article class="panel">
                  <h3>Today's Classes</h3>
                  <p class="headline">${todayClasses.length ? `${todayClasses.length} classes planned` : 'No classes planned today'}</p>
                  <p class="muted">Check class schedule and attached resources.</p>
                  <button class="cta-soft" data-student-nav="classes">Open Class Schedule</button>
                </article>
              </section>

              <section class="panel student-actions-panel">
                <h3>Quick Actions</h3>
                <div class="student-actions-grid">
                  <button class="cta-soft action-btn" data-student-nav="resources">View Resources</button>
                  <button class="cta-soft action-btn" data-student-nav="syllabus">View Syllabus</button>
                  <button class="cta-soft action-btn" data-student-nav="history">View Scores</button>
                  <button class="cta-soft action-btn" data-student-nav="planner">Open Study To-Do</button>
                </div>
              </section>

              <section class="two-grid">
                <article class="panel">
                  <h3>Streak + XP</h3>
                  <p class="headline">🔥 ${dashboard.streakDays || 0} day streak</p>
                  <p class="muted">Level ${dashboard.level || 1} | XP ${dashboard.xp || 0}</p>
                  <div class="progress-track">
                    <div class="progress-fill" style="width: ${levelProgressPercent(dashboard.xp)}%"></div>
                  </div>
                </article>
                <article class="panel">
                  <h3>Badges</h3>
                  <p class="muted">${
                    (dashboard.badges || []).length
                      ? (dashboard.badges || []).join(' • ')
                      : 'Attempt daily tests to unlock badges.'
                  }</p>
                  <button class="cta-soft" data-student-nav="history">View Latest Scores</button>
                </article>
              </section>
            `
            : ''
        }

        ${
          state.studentTab === 'today'
            ? `
              <section class="panel">
                <h3>Today's Tests</h3>
                ${
                  todayTests.length
                    ? todayTests
                        .map(
                          (test) => `
                            <article class="stack-item pending-item">
                              <div>
                                <p><strong>${escapeHtml(test.title)}</strong></p>
                                <p class="muted">${escapeHtml(test.subjectName || '')} | ${escapeHtml(formatTestType(test.type))} | ${escapeHtml(test.durationMinutes)} min</p>
                                <p class="muted">
                                  ${
                                    test.scheduledStartAt && test.scheduledEndAt
                                      ? `Window: ${escapeHtml(formatTestWindow(test))}`
                                      : 'Window: Always available'
                                  }
                                </p>
                                ${
                                  test.windowStatus === 'upcoming'
                                    ? `<p class="muted">Starts at ${escapeHtml(formatDate(test.scheduledStartAt))}</p>`
                                    : ''
                                }
                              </div>
                              <button class="cta-main" data-start-test="${test._id}" data-test-source="today" ${
                                test.canStart === false ? 'disabled' : ''
                              }>${test.canStart === false ? 'Not Open Yet' : 'Start Test'}</button>
                            </article>
                          `
                        )
                        .join('')
                    : '<p class="muted">No tests available today.</p>'
                }
              </section>
            `
            : ''
        }

        ${
          state.studentTab === 'pending'
            ? `
              <section class="panel">
                <h3>Pending Tests</h3>
                ${
                  pendingTests.length
                    ? pendingTests
                        .map(
                          (test) => `
                            <article class="stack-item pending-item">
                              <div>
                                <p><strong>${escapeHtml(test.title)}</strong></p>
                                <p class="muted">${escapeHtml(test.subjectName || '')} | ${escapeHtml(formatTestType(test.type))} | ${escapeHtml(test.durationMinutes)} min</p>
                                <p class="muted">
                                  ${
                                    test.scheduledStartAt && test.scheduledEndAt
                                      ? `Window: ${escapeHtml(formatTestWindow(test))}`
                                      : 'Window: Always available'
                                  }
                                </p>
                                ${
                                  test.windowStatus === 'closed'
                                    ? '<p class="muted">Window closed for this scheduled test.</p>'
                                    : ''
                                }
                              </div>
                              <button class="cta-main" data-start-test="${test._id}" data-test-source="pending" ${
                                test.canStart === false ? 'disabled' : ''
                              }>${test.canStart === false ? 'Window Closed' : 'Start Test'}</button>
                            </article>
                          `
                        )
                        .join('')
                    : '<p class="muted">No pending tests.</p>'
                }
              </section>
            `
            : ''
        }

        ${
          state.studentTab === 'classes'
            ? `
              <section class="panel">
                <h3>Today's Classes</h3>
                ${
                  todayClasses.length
                    ? todayClasses
                        .map(
                          (item) => `
                            <article class="stack-item">
                              <p><strong>${escapeHtml(item.title || 'Class')}</strong></p>
                              <p class="muted">${escapeHtml(item.subjectName || '-')} | ${escapeHtml(item.startTime || '--:--')} - ${escapeHtml(item.endTime || '--:--')}</p>
                              <p class="muted">Teacher: ${escapeHtml(item.teacherName || '-')}</p>
                              ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
                              ${
                                item.resource
                                  ? studentClassResourceMarkup(item.resource)
                                  : ''
                              }
                            </article>
                          `
                        )
                        .join('')
                    : '<p class="muted">No classes scheduled for today.</p>'
                }
              </section>
            `
            : ''
        }

        ${
          state.studentTab === 'resources'
            ? `
              <section class="panel">
                <h3>Resources</h3>
                <div class="two-grid-form">
                  <div>
                    <label for="studentResourceSearch">Search</label>
                    <input id="studentResourceSearch" type="text" value="${escapeHtml(state.studentResourceSearch)}" placeholder="e.g. Introduction to MS Word" />
                  </div>
                  <div>
                    <label for="studentResourceType">Type</label>
                    <select id="studentResourceType">
                      <option value="">All</option>
                      <option value="pdf" ${state.studentResourceType === 'pdf' ? 'selected' : ''}>PDF</option>
                      <option value="ebook" ${state.studentResourceType === 'ebook' ? 'selected' : ''}>EBook</option>
                      <option value="video" ${state.studentResourceType === 'video' ? 'selected' : ''}>Video</option>
                      <option value="link" ${state.studentResourceType === 'link' ? 'selected' : ''}>Link</option>
                    </select>
                  </div>
                  <div>
                    <label for="studentResourceSubjectId">Subject</label>
                    <select id="studentResourceSubjectId">
                      <option value="">All Subjects</option>
                      ${subjects
                        .map(
                          (subject) =>
                            `<option value="${subject._id || subject.id}" ${
                              state.studentResourceSubjectId === (subject._id || subject.id) ? 'selected' : ''
                            }>${escapeHtml(subject.name)}</option>`
                        )
                        .join('')}
                    </select>
                  </div>
                </div>
              </section>

              <section class="panel">
                ${resourcesGroupedMarkup(resources)}
              </section>
            `
            : ''
        }

        ${
          state.studentTab === 'syllabus'
            ? `
              <section class="panel">
                <h3>Syllabus</h3>
                <label for="studentSyllabusSubjectId">Choose Subject</label>
                <select id="studentSyllabusSubjectId">
                  <option value="">All Subjects</option>
                  ${syllabi
                    .map(
                      (item) =>
                        `<option value="${item._id}" ${
                          state.studentSyllabusSubjectId === item._id ? 'selected' : ''
                        }>${escapeHtml(item.name)}</option>`
                    )
                    .join('')}
                </select>

                <div class="table-wrap" style="margin-top:10px;">
                  <table>
                    <thead>
                      <tr>
                        <th>Subject</th>
                        <th>Teacher</th>
                        <th>Syllabus</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        syllabi
                          .filter((item) =>
                            state.studentSyllabusSubjectId ? item._id === state.studentSyllabusSubjectId : true
                          )
                          .map(
                            (item) => `
                              <tr>
                                <td>${escapeHtml(item.name)}</td>
                                <td>${escapeHtml(item.teacherName || '-')}</td>
                                <td>${
                                  item.viewUrl
                                    ? `<button
                                        type="button"
                                        class="mini-btn"
                                        data-open-student-pdf="1"
                                        data-pdf-url="${escapeHtml(item.viewUrl)}"
                                        data-pdf-title="${escapeHtml(item.name || 'Syllabus')}"
                                      >View File</button>`
                                    : '-'
                                }</td>
                              </tr>
                            `
                          )
                          .join('') || '<tr><td colspan="3">No syllabus available.</td></tr>'
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            `
            : ''
        }

        ${
          state.studentTab === 'history'
            ? `
              <section class="panel table-panel">
                <h3>Test History</h3>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Test</th>
                        <th>Type</th>
                        <th>Score</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        history.length
                          ? history
                              .map(
                                (item) => `
                                  <tr>
                                    <td>${formatDate(item.createdAt)}</td>
                                    <td>${escapeHtml(item.test?.title || '-')}</td>
                                    <td>${escapeHtml((item.type || '-').toUpperCase())}</td>
                                    <td>${item.scorePercent == null ? '-' : `${escapeHtml(item.scorePercent)}%`}</td>
                                    <td>
                                      ${
                                        item.answerKeyAvailable
                                          ? `<button class="mini-btn" data-answer-key-attempt="${item._id}" data-answer-key-title="${escapeHtml(
                                              item.test?.title || 'test'
                                            )}">Answer Key</button>`
                                          : '-'
                                      }
                                    </td>
                                  </tr>
                                `
                              )
                              .join('')
                          : '<tr><td colspan="5">No attempts yet.</td></tr>'
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            `
            : ''
        }

        ${
          state.studentTab === 'planner'
            ? `
              <section class="panel">
                <h3>My Study To-Do</h3>
                <p class="muted">Plan your own day, tick tasks as done, and keep momentum.</p>
                <div class="two-grid-form">
                  <div>
                    <label for="studentTodoTitle">Task</label>
                    <input id="studentTodoTitle" type="text" placeholder="e.g. Revise chapter 3" />
                  </div>
                  <div>
                    <label for="studentTodoDueDate">Due Date (optional)</label>
                    <input id="studentTodoDueDate" type="date" />
                  </div>
                </div>
                <button id="studentAddTodoBtn" class="cta-main">Add Task</button>
                <p class="auth-note" id="studentTodoStatus"></p>
              </section>

              <section class="panel">
                <div class="progress-row">
                  <h3>Pending Tasks</h3>
                  <strong>${pendingTodos.length}</strong>
                </div>
                <div class="todo-list">
                  ${
                    pendingTodos.length
                      ? pendingTodos
                          .map(
                            (item) => `
                              <article class="todo-item">
                                <label class="todo-check">
                                  <input type="checkbox" data-toggle-todo="${item.id}" />
                                  <span>${escapeHtml(item.text)}</span>
                                </label>
                                <div class="todo-actions">
                                  <small>${item.dueDate ? `Due: ${escapeHtml(item.dueDate)}` : ''}</small>
                                  <button class="mini-btn danger" data-delete-todo="${item.id}">Delete</button>
                                </div>
                              </article>
                            `
                          )
                          .join('')
                      : '<p class="muted">No pending tasks. Add one above.</p>'
                  }
                </div>
              </section>

              <section class="panel">
                <div class="progress-row">
                  <h3>Completed</h3>
                  <strong>${completedTodos.length}</strong>
                </div>
                <div class="todo-list done">
                  ${
                    completedTodos.length
                      ? completedTodos
                          .map(
                            (item) => `
                              <article class="todo-item done">
                                <label class="todo-check">
                                  <input type="checkbox" data-toggle-todo="${item.id}" checked />
                                  <span>${escapeHtml(item.text)}</span>
                                </label>
                                <div class="todo-actions">
                                  <small>${item.dueDate ? `Due: ${escapeHtml(item.dueDate)}` : ''}</small>
                                  <button class="mini-btn danger" data-delete-todo="${item.id}">Delete</button>
                                </div>
                              </article>
                            `
                          )
                          .join('')
                      : '<p class="muted">No completed tasks yet.</p>'
                  }
                </div>
                <button id="studentClearCompletedBtn" class="cta-soft">Clear Completed</button>
              </section>
            `
            : ''
        }

        ${state.studentTab === 'accounts' ? accountSectionMarkup(user) : ''}
        <button class="cta-soft mini-qa-btn floating-qa-btn" id="runQaBtn">Run QA Check</button>
      </main>

      ${
        state.studentPdfViewer
          ? `
            <div class="test-modal-backdrop" data-close-student-pdf></div>
            <section class="test-modal" role="dialog" aria-modal="true" aria-label="Student PDF Viewer">
              <div class="test-modal-card">
                <div class="progress-row">
                  <h3>${escapeHtml(state.studentPdfViewer.title || 'PDF Viewer')}</h3>
                  <button class="mini-btn" type="button" data-close-student-pdf>Close</button>
                </div>
                <p class="muted">Protected view mode enabled. Download is disabled in this interface.</p>
                <p class="muted" id="studentPdfStatus">Loading PDF...</p>
                <div class="pdf-viewer resource-pdf-viewer student-pdf-canvas-root" id="studentPdfCanvasRoot"></div>
              </div>
            </section>
          `
          : ''
      }
    </div>
  `;

  document.querySelectorAll('[data-student-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.studentTab = button.getAttribute('data-student-tab') || 'dashboard';
      closeOpenNavDropdowns();
      void renderStudentDashboard();
    });
  });
  bindNavDropdowns();

  document.querySelectorAll('[data-student-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      state.studentTab = button.getAttribute('data-student-nav') || 'dashboard';
      void renderStudentDashboard();
    });
  });

  document.getElementById('logoutBtn').addEventListener('click', logout);

  const runQaBtn = document.getElementById('runQaBtn');
  if (runQaBtn) {
    runQaBtn.addEventListener('click', async () => {
      if (state.qaRunningRole === 'student') return;
      state.qaRunningRole = 'student';
      await withButtonLoading(runQaBtn, 'Checking...', async () => {
        const report = await runRoleSmokeChecks('student');
        state.qaReports.student = report;
        if (report.failedCount > 0) {
          showToast(`QA finished: ${report.failedCount} check(s) failed.`, 'error', 3200);
        } else {
          showToast('QA finished: all checks passed.', 'success', 2200);
        }
      });
      state.qaRunningRole = '';
      await renderStudentDashboard();
    });
  }

  document.querySelectorAll('[data-start-test]').forEach((button) => {
    button.addEventListener('click', () => {
      const testId = button.getAttribute('data-start-test');
      const source = button.getAttribute('data-test-source') || 'today';
      const test = testMap.get(testId);
      if (!test) return;
      if (test.canStart === false) {
        if (test.windowStatus === 'upcoming') {
          showToast(`This test opens at ${formatDate(test.scheduledStartAt)}.`, 'error');
        } else if (test.windowStatus === 'closed') {
          showToast('This test window is closed.', 'error');
        } else {
          showToast('This test is not available right now.', 'error');
        }
        return;
      }
      renderStudentTestAttempt(test, source === 'pending' ? 'pending' : 'today');
    });
  });

  const studentResourceSearch = document.getElementById('studentResourceSearch');
  if (studentResourceSearch) {
    studentResourceSearch.addEventListener('input', (event) => {
      const nextValue = event.target.value;
      debounceByKey('student-resource-search', () => {
        state.studentResourceSearch = nextValue;
        void renderStudentDashboard();
      });
    });
  }

  const studentResourceType = document.getElementById('studentResourceType');
  if (studentResourceType) {
    studentResourceType.addEventListener('change', (event) => {
      state.studentResourceType = event.target.value;
      void renderStudentDashboard();
    });
  }

  const studentResourceSubjectId = document.getElementById('studentResourceSubjectId');
  if (studentResourceSubjectId) {
    studentResourceSubjectId.addEventListener('change', (event) => {
      state.studentResourceSubjectId = event.target.value;
      void renderStudentDashboard();
    });
  }

  const studentSyllabusSubjectId = document.getElementById('studentSyllabusSubjectId');
  if (studentSyllabusSubjectId) {
    studentSyllabusSubjectId.addEventListener('change', (event) => {
      state.studentSyllabusSubjectId = event.target.value;
      void renderStudentDashboard();
    });
  }

  document.querySelectorAll('[data-open-student-pdf]').forEach((button) => {
    button.addEventListener('click', () => {
      const url = String(button.getAttribute('data-pdf-url') || '').trim();
      const title = String(button.getAttribute('data-pdf-title') || 'PDF Viewer').trim();
      if (!url) {
        showToast('PDF URL is missing.', 'error');
        return;
      }
      state.studentPdfViewer = { url, title };
      void renderStudentDashboard();
    });
  });

  document.querySelectorAll('[data-close-student-pdf]').forEach((button) => {
    button.addEventListener('click', () => {
      state.studentPdfViewer = null;
      void renderStudentDashboard();
    });
  });

  if (state.studentPdfViewer?.url) {
    void renderStudentProtectedPdfDocument(state.studentPdfViewer.url);
  }

  const studentAddTodoBtn = document.getElementById('studentAddTodoBtn');
  if (studentAddTodoBtn) {
    studentAddTodoBtn.addEventListener('click', () => {
      const status = document.getElementById('studentTodoStatus');
      const title = sanitizeValue(document.getElementById('studentTodoTitle')?.value || '');
      const dueDate = String(document.getElementById('studentTodoDueDate')?.value || '').trim();
      if (!title) {
        if (status) status.textContent = 'Task title is required.';
        showToast('Task title is required.', 'error');
        return;
      }

      const id =
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

      const nextTodos = [
        {
          id,
          text: title,
          dueDate,
          completed: false,
          createdAt: new Date().toISOString()
        },
        ...todoItems
      ];
      saveStudentTodos(user.id || user._id, nextTodos);
      showToast('Task added.', 'success');
      void renderStudentDashboard();
    });
  }

  document.querySelectorAll('[data-toggle-todo]').forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const todoId = event.target.getAttribute('data-toggle-todo');
      if (!todoId) return;
      const nextTodos = todoItems.map((item) =>
        item.id === todoId ? { ...item, completed: !item.completed } : item
      );
      saveStudentTodos(user.id || user._id, nextTodos);
      void renderStudentDashboard();
    });
  });

  document.querySelectorAll('[data-delete-todo]').forEach((button) => {
    button.addEventListener('click', () => {
      const todoId = button.getAttribute('data-delete-todo');
      if (!todoId) return;
      const nextTodos = todoItems.filter((item) => item.id !== todoId);
      saveStudentTodos(user.id || user._id, nextTodos);
      showToast('Task deleted.', 'success');
      void renderStudentDashboard();
    });
  });

  const studentClearCompletedBtn = document.getElementById('studentClearCompletedBtn');
  if (studentClearCompletedBtn) {
    studentClearCompletedBtn.addEventListener('click', () => {
      const nextTodos = todoItems.filter((item) => !item.completed);
      saveStudentTodos(user.id || user._id, nextTodos);
      showToast('Completed tasks cleared.', 'success');
      void renderStudentDashboard();
    });
  }

  document.querySelectorAll('[data-answer-key-attempt]').forEach((button) => {
    button.addEventListener('click', async () => {
      const attemptId = button.getAttribute('data-answer-key-attempt');
      const title = button.getAttribute('data-answer-key-title') || 'test';
      if (!attemptId) return;

      await withButtonLoading(button, 'Opening...', async () => {
        try {
          const result = await api(`/student/tests/attempts/${attemptId}/answer-key`);
          openStudentAnswerKeyViewer(result.data, `${String(title)} - Answer Key`);
          showToast('Answer key opened.', 'success');
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  });

  bindAccountPasswordForm();
  endNavTransition();
}

async function renderByRole() {
  if (!state.session?.user?.role) {
    renderWelcome();
    return;
  }

  try {
    if (state.session.user.role === 'admin') {
      await renderAdminDashboard();
      return;
    }

    if (state.session.user.role === 'teacher') {
      await renderTeacherDashboard();
      return;
    }

    if (state.session.user.role === 'student') {
      await renderStudentDashboard();
      return;
    }

    if (state.session.user.role === 'super_admin') {
      window.location.href = '/owner.html';
      return;
    }

    renderWelcome();
  } catch (error) {
    if (/unauthorized/i.test(error.message)) {
      saveSession(null);
      renderWelcome();
      return;
    }

    app.innerHTML = `
      <section class="welcome-page live-welcome">
        <div class="hero-overlay"></div>
        <div class="hero-content">
          <div class="auth-card live-auth-card">
            <h2 class="auth-title">Unable to load portal</h2>
            <p class="auth-subtitle">${escapeHtml(error.message)}</p>
            <button class="cta-main" id="retryBtn">Retry</button>
            <button class="back-link-btn" id="backBtn">Back to Home</button>
          </div>
        </div>
        <footer class="hero-footer">Developed by LIFT Educations</footer>
      </section>
    `;

    document.getElementById('retryBtn').addEventListener('click', () => {
      void renderByRole();
    });
    document.getElementById('backBtn').addEventListener('click', () => {
      saveSession(null);
      resetUiStateOnLogout();
      renderWelcome();
    });
  }
}

if (state.session) {
  void renderByRole();
} else {
  renderWelcome();
}
