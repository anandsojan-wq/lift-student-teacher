const app = document.getElementById('app');

const SESSION_KEY = 'lift_live_session_v2';
const SESSION_REMEMBER_KEY = 'lift_live_session_remember_v1';
const LOGIN_HINTS_KEY = 'lift_live_login_hints_v1';
const STUDENT_TODO_KEY = 'lift_student_todos_v1';
const API_CANDIDATE_PORTS = Array.from({ length: 21 }, (_, index) => 5050 + index);
const MCQ_QUESTION_LIMIT = 20;
const MCQ_DURATION_MINUTES = 5;

if (typeof window !== 'undefined' && window.pdfjsLib?.GlobalWorkerOptions) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const runtime = {
  attemptTimerId: null,
  attemptSubmitting: false,
  debounceHandles: {}
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
  teacherTestAudienceMode: 'all',
  teacherTestSelectedStudentIds: [],
  teacherAssessmentSubjectId: '',
  teacherAssessmentType: '',
  teacherAssessmentStatus: 'pending',
  teacherAssessmentQuery: '',
  studentResourceSearch: '',
  studentResourceType: '',
  studentResourceSubjectId: '',
  studentSyllabusSubjectId: ''
};

function loadSession() {
  const parseStorage = (storage) => {
    try {
      const raw = storage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.token || !parsed.user || !parsed.institutionId) return null;
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
  state.session = session;
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    return;
  }

  const serialized = JSON.stringify(session);
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
  state.teacherTestAudienceMode = 'all';
  state.teacherTestSelectedStudentIds = [];
  state.teacherAssessmentSubjectId = '';
  state.teacherAssessmentType = '';
  state.teacherAssessmentStatus = 'pending';
  state.teacherAssessmentQuery = '';
  state.studentResourceSearch = '';
  state.studentResourceType = '';
  state.studentResourceSubjectId = '';
  state.studentSyllabusSubjectId = '';
}

function clearAttemptTimer() {
  if (runtime.attemptTimerId) {
    clearInterval(runtime.attemptTimerId);
    runtime.attemptTimerId = null;
  }
  runtime.attemptSubmitting = false;
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
  return String(value || '')
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

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return String(value);
  }
}

function formatTestType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'mcq') return 'MCQ';
  if (normalized === 'true_false') return 'TRUE / FALSE';
  if (normalized === 'long') return 'LONG ANSWER';
  if (normalized === 'short') return 'SHORT ANSWER';
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

function navButtonsMarkup(items, activeValue, attrName) {
  return items
    .map(
      (item) =>
        `<button class="nav-tab ${activeValue === item.value ? 'active' : ''}" ${attrName}="${item.value}">${escapeHtml(item.label)}</button>`
    )
    .join('');
}

function objectiveQuestionBuilderMarkup(type) {
  const isTrueFalse = type === 'true_false';
  const cards = Array.from({ length: MCQ_QUESTION_LIMIT }, (_, index) => {
    const serial = index + 1;
    if (isTrueFalse) {
      return `
        <article class="question-builder-card">
          <h4>Question ${serial}</h4>
          <input id="objective-q-${index}" type="text" placeholder="Enter question ${serial}" />
          <select id="objective-q-${index}-answer">
            <option value="0">Correct Answer: True</option>
            <option value="1">Correct Answer: False</option>
          </select>
        </article>
      `;
    }

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
      <p class="muted">Use the boxes below to create all ${MCQ_QUESTION_LIMIT} questions.</p>
      <div class="objective-builder-grid">${cards}</div>
    </section>
  `;
}

function collectObjectiveQuestions(type) {
  const questions = [];
  for (let index = 0; index < MCQ_QUESTION_LIMIT; index += 1) {
    const questionText = sanitizeValue(
      document.getElementById(`objective-q-${index}`)?.value || ''
    );
    if (!questionText) {
      throw new Error(`Question ${index + 1} text is required.`);
    }

    if (type === 'true_false') {
      const correctIndex = Number(
        document.getElementById(`objective-q-${index}-answer`)?.value
      );
      if (correctIndex !== 0 && correctIndex !== 1) {
        throw new Error(`Question ${index + 1} must have a correct answer.`);
      }
      questions.push({
        text: questionText,
        options: ['True', 'False'],
        correctIndex
      });
      continue;
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

function bindTabButtons(selector, callback) {
  document.querySelectorAll(selector).forEach((button) => {
    button.addEventListener('click', () => callback(button));
  });
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

function parseLongQuestions(raw) {
  const lines = String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new Error('Add at least one long question.');
  }

  return lines.map((line) => ({ text: line }));
}

function assessmentAnswersMarkup(attempt) {
  const answers = Array.isArray(attempt?.answers) ? attempt.answers : [];
  if (!answers.length) return '<span class="muted">-</span>';

  if (attempt.type !== 'short' && attempt.type !== 'long') {
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
                <p class="muted"><strong>Answer:</strong> ${escapeHtml(item.answerText || '(No answer)')}</p>
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
  const headers = {
    ...(options.headers || {})
  };

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  if (state.session?.token) {
    headers.Authorization = `Bearer ${state.session.token}`;
  }

  const response = await fetch(`${base}${path}`, {
    ...options,
    headers
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

  return payload;
}

function logout() {
  clearAttemptTimer();
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
}

function renderLogin(role) {
  clearAttemptTimer();
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
          body: JSON.stringify({ institutionId, username, password })
        });

        if (result.data.user.role !== role) {
          status.textContent = `This account is ${roleLabel(result.data.user.role)}. Use correct login.`;
          showToast(status.textContent, 'error');
          return;
        }

        saveSession({
          token: result.data.token,
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
}

async function renderAdminDashboard() {
  clearAttemptTimer();

  const [meData, summaryResult, teachersResult, subjectsResult] =
    await Promise.all([
      fetchMe(),
      api('/admin/summary'),
      api('/admin/teachers'),
      api('/admin/subjects')
    ]);

  const studentsQuery = toQueryString({
    q: state.adminStudentQuery,
    subjectId: state.adminSubjectFilter
  });
  const studentsResult = await api(`/admin/students${studentsQuery}`);

  let analytics = null;
  if (state.adminTab === 'analytics') {
    const analyticsResult = await api(
      `/admin/analytics${toQueryString({ days: state.adminAnalyticsWindow })}`
    );
    analytics = analyticsResult.data.analytics || null;
  }

  const user = meData.user;
  const summary = summaryResult.data.summary;
  const teachers = teachersResult.data.teachers || [];
  const students = studentsResult.data.students || [];
  const subjects = subjectsResult.data.subjects || [];

  app.innerHTML = `
    <div class="dashboard-shell">
      <header class="main-nav">
        <div class="left-nav">
          ${logoMarkup(true)}
          ${navButtonsMarkup(
            [
              { value: 'dashboard', label: 'Dashboard' },
              { value: 'analytics', label: 'Analytics' },
              { value: 'teachers', label: 'Teachers' },
              { value: 'students', label: 'Students' },
              { value: 'accounts', label: 'Accounts' }
            ],
            state.adminTab,
            'data-admin-tab'
          )}
        </div>
        <button class="signout" id="logoutBtn">Sign Out</button>
      </header>

      <main class="page container-xl">
        <h2>Welcome, ${escapeHtml(user.fullName)} 👋</h2>
        <p class="subline">Institution ID: ${escapeHtml(meData.institution?.institutionId || state.session.institutionId)}</p>

        ${
          state.adminTab === 'dashboard'
            ? `
              <section class="stats-grid">
                <article class="panel stat"><h3>${summary.teacherCount}</h3><p>Total Teachers</p></article>
                <article class="panel stat"><h3>${summary.studentCount}</h3><p>Total Students</p></article>
                <article class="panel stat"><h3>${summary.subjectCount}</h3><p>Total Subjects</p></article>
                <article class="panel stat"><h3>${teachers.length ? Math.round((summary.studentCount / teachers.length) * 10) / 10 : 0}</h3><p>Students / Teacher</p></article>
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
          state.adminTab === 'teachers'
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

              <section class="panel table-panel">
                <h3>Teacher Accounts</h3>
                <p class="muted">Share links are available for accounts created in this admin session.</p>
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
                                  const tempPassword =
                                    state.adminTeacherSecrets[teacher.username] || '';
                                  const shareMessage = encodeURIComponent(
                                    `LIFT Educations login\nInstitution ID: ${state.session.institutionId}\nUsername: ${teacher.username}\nTemporary Password: ${tempPassword}`
                                  );
                                  const whatsPhone = cleanPhone(teacher.phone);

                                  return `
                                  <tr>
                                    <td>${escapeHtml(teacher.fullName)}</td>
                                    <td>${escapeHtml(teacher.username)}</td>
                                    <td>${tempPassword ? escapeHtml(tempPassword) : '<span class="muted">not available</span>'}</td>
                                    <td>${escapeHtml(teacher.email || '-')}</td>
                                    <td>${escapeHtml(teacher.phone || '-')}</td>
                                    <td>
                                      ${
                                        tempPassword && whatsPhone
                                          ? `<a href="https://wa.me/${whatsPhone}?text=${shareMessage}" target="_blank" rel="noreferrer">WhatsApp</a>`
                                          : '-'
                                      }
                                      ${
                                        tempPassword
                                          ? ` | <button class="mini-btn" data-copy-teacher-creds="${teacher.username}">Copy</button>`
                                          : ''
                                      }
                                    </td>
                                    <td><button class="mini-btn danger" data-delete-teacher="${teacher._id}">Delete</button></td>
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
          state.adminTab === 'students'
            ? `
              <section class="panel">
                <h3>Students</h3>
                <div class="two-grid-form">
                  <div>
                    <label for="adminStudentSearch">Search by Name</label>
                    <input id="adminStudentSearch" type="text" value="${escapeHtml(state.adminStudentQuery)}" placeholder="Type student name" />
                  </div>
                  <div>
                    <label for="adminSubjectFilter">Filter by Subject</label>
                    <select id="adminSubjectFilter">
                      <option value="">All Subjects</option>
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
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Username</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Subjects</th>
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
      </main>
    </div>
  `;

  bindTabButtons('[data-admin-tab]', (button) => {
    state.adminTab = button.getAttribute('data-admin-tab') || 'dashboard';
    void renderAdminDashboard();
  });

  document.getElementById('logoutBtn').addEventListener('click', logout);

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
          void renderAdminDashboard();
        } catch (error) {
          status.textContent = error.message;
          showToast(error.message, 'error');
        }
      });
    });
  }

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
      const tempPassword = state.adminTeacherSecrets[username];
      if (!tempPassword) {
        showToast('Temporary password not available for this teacher in current session.', 'error');
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
          void renderAdminDashboard();
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
          tempPassword: state.adminTeacherSecrets[teacher.username] || '',
          email: teacher.email || '',
          phone: teacher.phone || '',
          institutionId: state.session.institutionId
        }))
        .filter((row) => row.tempPassword);

      if (!rows.length) {
        showToast('No temporary passwords available in this session to export.', 'error');
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
}

async function renderTeacherDashboard() {
  clearAttemptTimer();

  const [meData, subjectsResult] = await Promise.all([
    fetchMe(),
    api('/teacher/subjects')
  ]);

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
  const studentsResult = await api(`/teacher/students${studentQuery}`);
  const students = studentsResult.data.students || [];
  const availableStudentsForTest = state.teacherTestSubjectId
    ? students.filter((student) =>
        (student.subjects || []).some((item) => item.id === state.teacherTestSubjectId)
      )
    : [];

  if (state.teacherTestAudienceMode !== 'all' && state.teacherTestAudienceMode !== 'selected') {
    state.teacherTestAudienceMode = 'all';
  }

  const allowedTestStudentIds = new Set(availableStudentsForTest.map((student) => student._id));
  state.teacherTestSelectedStudentIds = (state.teacherTestSelectedStudentIds || []).filter((studentId) =>
    allowedTestStudentIds.has(studentId)
  );

  let resources = [];
  if (state.teacherTab === 'resources' || state.teacherTab === 'dashboard') {
    const resourcesQuery =
      state.teacherTab === 'resources'
        ? toQueryString({
            subjectId: state.teacherResourceSubjectId,
            resourceType: state.teacherResourceType,
            q: state.teacherResourceSearch
          })
        : '';
    const resourceResult = await api(`/teacher/resources${resourcesQuery}`);
    resources = resourceResult.data.resources || [];
  }

  let tests = [];
  if (state.teacherTab === 'tests' || state.teacherTab === 'dashboard') {
    const testsQuery = toQueryString({
      subjectId: state.teacherTestSubjectId
    });
    const testsResult = await api(`/teacher/tests${testsQuery}`);
    tests = testsResult.data.tests || [];
  }

  let dashboardClassPlans = [];
  if (state.teacherTab === 'dashboard') {
    const dashboardPlansResult = await api(
      `/teacher/class-plans${toQueryString({ date: todayIsoDate() })}`
    );
    dashboardClassPlans = dashboardPlansResult.data.plans || [];
  }

  let classPlans = [];
  if (state.teacherTab === 'class_planner') {
    const classPlansResult = await api(
      `/teacher/class-plans${toQueryString({ date: state.teacherClassPlanDate || todayIsoDate() })}`
    );
    classPlans = classPlansResult.data.plans || [];
  }

  let assessments = [];
  if (state.teacherTab === 'assessment') {
    const assessmentResult = await api(
      `/teacher/assessments${toQueryString({
        subjectId: state.teacherAssessmentSubjectId,
        type: state.teacherAssessmentType,
        status: state.teacherAssessmentStatus,
        q: state.teacherAssessmentQuery
      })}`
    );
    assessments = assessmentResult.data.assessments || [];
  }

  const user = meData.user;

  app.innerHTML = `
    <div class="dashboard-shell">
      <header class="main-nav">
        <div class="left-nav">
          ${logoMarkup(true)}
          ${navButtonsMarkup(
            [
              { value: 'dashboard', label: 'Dashboard' },
              { value: 'subjects', label: 'Subjects' },
              { value: 'students', label: 'Students' },
              { value: 'class_planner', label: 'Class Planner' },
              { value: 'resources', label: 'Upload Resources' },
              { value: 'tests', label: 'Conduct Test' },
              { value: 'assessment', label: 'Assessment' },
              { value: 'accounts', label: 'Accounts' }
            ],
            state.teacherTab,
            'data-teacher-tab'
          )}
        </div>
        <button class="signout" id="logoutBtn">Sign Out</button>
      </header>

      <main class="page container-xl">
        <h2>Welcome, ${escapeHtml(user.fullName)} 👋</h2>
        <p class="subline">Manage classes, subjects, students and tests from one place.</p>

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
              <section class="panel">
                <h3>Create Subject (Syllabus Required)</h3>
                <form id="createSubjectForm" class="two-grid-form">
                  <div>
                    <label for="subjectName">Subject Name</label>
                    <input id="subjectName" type="text" required />
                  </div>
                  <div>
                    <label for="syllabusPdfFile">Syllabus PDF File</label>
                    <input id="syllabusPdfFile" type="file" accept=".pdf,application/pdf" required />
                  </div>
                </form>
                <button id="createSubjectBtn" class="cta-main">Create Subject</button>
                <p class="auth-note" id="createSubjectStatus"></p>
              </section>

              <section class="panel table-panel">
                <h3>Syllabus Manager</h3>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Subject</th>
                        <th>Syllabus</th>
                        <th>Created</th>
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
                                    <td>${
                                      subject.syllabusPdfUrl
                                        ? `<a href="${escapeHtml(subject.syllabusPdfUrl)}" target="_blank" rel="noreferrer">Open Syllabus</a>`
                                        : '-'
                                    }</td>
                                    <td>${formatDate(subject.createdAt)}</td>
                                    <td>
                                      <button class="mini-btn" data-update-syllabus="${subject._id}">Upload New Syllabus</button>
                                      <button class="mini-btn danger" data-delete-subject="${subject._id}">Delete</button>
                                    </td>
                                  </tr>
                                `
                              )
                              .join('')
                          : '<tr><td colspan="4">No subjects yet.</td></tr>'
                      }
                    </tbody>
                  </table>
                </div>
                <input id="updateSyllabusFileInput" type="file" accept=".pdf,application/pdf" hidden />
                <p class="auth-note" id="updateSyllabusStatus"></p>
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
                                  state.teacherStudentSecrets[student.username] || '';
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
                                          ? plan.resource.source === 'file'
                                            ? `<a href="${escapeHtml(plan.resource.value)}" download="${escapeHtml(plan.resource.title || 'resource')}">Download</a>`
                                            : `<a href="${escapeHtml(plan.resource.value)}" target="_blank" rel="noreferrer">Open</a>`
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
                                          ? `<a href="${escapeHtml(resource.value)}" download="${escapeHtml(resource.title || 'resource')}">Download</a>`
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
          state.teacherTab === 'tests'
            ? `
              <section class="panel">
                <h3>Create Test</h3>
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
                    <label for="testType">Type</label>
                    <select id="testType">
                      <option value="mcq" ${state.teacherTestType === 'mcq' ? 'selected' : ''}>MCQ (20 Questions / 5 Minutes)</option>
                      <option value="true_false" ${state.teacherTestType === 'true_false' ? 'selected' : ''}>True / False (20 Questions / 5 Minutes)</option>
                      <option value="long" ${state.teacherTestType === 'long' ? 'selected' : ''}>Long Format</option>
                      <option value="short" ${state.teacherTestType === 'short' ? 'selected' : ''}>Short Answer</option>
                    </select>
                  </div>
                  <div>
                    <label for="testDuration">Duration Minutes (Subjective only)</label>
                    <select id="testDuration">
                      <option value="30">30</option>
                      <option value="60">60</option>
                      <option value="90">90</option>
                      <option value="120">120</option>
                    </select>
                  </div>
                  <div>
                    <label for="testAudienceMode">Audience</label>
                    <select id="testAudienceMode">
                      <option value="all" ${state.teacherTestAudienceMode === 'all' ? 'selected' : ''}>All students in selected subject</option>
                      <option value="selected" ${state.teacherTestAudienceMode === 'selected' ? 'selected' : ''}>Selected students only</option>
                    </select>
                  </div>
                </form>

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
                                    .map(
                                      (student) => `
                                        <label class="target-student-item">
                                          <input
                                            type="checkbox"
                                            data-test-target-student="${student._id}"
                                            ${state.teacherTestSelectedStudentIds.includes(student._id) ? 'checked' : ''}
                                          />
                                          <span>${escapeHtml(student.fullName)} <small>@${escapeHtml(student.username)}</small></span>
                                        </label>
                                      `
                                    )
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
                  state.teacherTestType === 'mcq' || state.teacherTestType === 'true_false'
                    ? objectiveQuestionBuilderMarkup(state.teacherTestType)
                    : `
                      <label for="testQuestionsInput">${
                        state.teacherTestType === 'short'
                          ? 'Short-answer questions: one question per line'
                          : 'Long-format questions: one question per line'
                      }</label>
                      <textarea id="testQuestionsInput" rows="8" placeholder="Write question 1 on first line"></textarea>
                    `
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
                        <th>Created</th>
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
                                    <td>${formatDate(test.createdAt)}</td>
                                  </tr>
                                `
                              )
                              .join('')
                          : '<tr><td colspan="5">No tests published.</td></tr>'
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            `
            : ''
        }

        ${
          state.teacherTab === 'assessment'
            ? `
              <section class="panel">
                <h3>Assessment</h3>
                <p class="muted">Review student submissions and assign marks for short-form and long-form tests.</p>
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
                      <option value="short" ${state.teacherAssessmentType === 'short' ? 'selected' : ''}>Short Answer</option>
                      <option value="long" ${state.teacherAssessmentType === 'long' ? 'selected' : ''}>Long Answer</option>
                      <option value="mcq" ${state.teacherAssessmentType === 'mcq' ? 'selected' : ''}>MCQ</option>
                      <option value="true_false" ${state.teacherAssessmentType === 'true_false' ? 'selected' : ''}>True / False</option>
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
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Submitted</th>
                        <th>Student</th>
                        <th>Subject</th>
                        <th>Test</th>
                        <th>Type</th>
                        <th>Score</th>
                        <th>Answers</th>
                        <th>Grade</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        assessments.length
                          ? assessments
                              .map((attempt) => {
                                const isSubjective =
                                  attempt.type === 'short' || attempt.type === 'long';
                                const scoreText =
                                  attempt.scorePercent == null ? 'Pending' : `${attempt.scorePercent}%`;
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
      </main>
    </div>
  `;

  bindTabButtons('[data-teacher-tab]', (button) => {
    state.teacherTab = button.getAttribute('data-teacher-tab') || 'dashboard';
    void renderTeacherDashboard();
  });

  document.getElementById('logoutBtn').addEventListener('click', logout);

  const createSubjectBtn = document.getElementById('createSubjectBtn');
  if (createSubjectBtn) {
    createSubjectBtn.addEventListener('click', async () => {
      const status = document.getElementById('createSubjectStatus');
      const form = document.getElementById('createSubjectForm');
      if (form && !form.reportValidity()) return;
      status.textContent = 'Creating subject...';

      await withButtonLoading(createSubjectBtn, 'Creating...', async () => {
        try {
          const name = sanitizeValue(document.getElementById('subjectName').value);
          const syllabusFile = document.getElementById('syllabusPdfFile').files[0] || null;

          if (name.length < 2) {
            status.textContent = 'Subject name must be at least 2 characters.';
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

          const payload = {
            name,
            syllabusPdfUrl: uploadedSyllabus.url,
            syllabusPdfName: syllabusFile.name
          };

          await api('/teacher/subjects', {
            method: 'POST',
            body: JSON.stringify(payload)
          });

          status.textContent = 'Subject created.';
          showToast('Subject created successfully.', 'success');
          void renderTeacherDashboard();
        } catch (error) {
          status.textContent = error.message;
          showToast(error.message, 'error');
        }
      });
    });
  }

  let syllabusUpdateSubjectId = '';
  const updateSyllabusFileInput = document.getElementById('updateSyllabusFileInput');
  const updateSyllabusStatus = document.getElementById('updateSyllabusStatus');

  document.querySelectorAll('[data-update-syllabus]').forEach((button) => {
    button.addEventListener('click', () => {
      syllabusUpdateSubjectId = button.getAttribute('data-update-syllabus') || '';
      if (!syllabusUpdateSubjectId || !updateSyllabusFileInput) return;
      updateSyllabusFileInput.value = '';
      updateSyllabusFileInput.click();
    });
  });

  if (updateSyllabusFileInput) {
    updateSyllabusFileInput.addEventListener('change', async () => {
      const syllabusFile = updateSyllabusFileInput.files?.[0] || null;
      if (!syllabusUpdateSubjectId || !syllabusFile) return;
      if (!/\.pdf$/i.test(syllabusFile.name)) {
        if (updateSyllabusStatus) updateSyllabusStatus.textContent = 'Please upload a PDF file.';
        showToast('Please upload a PDF file.', 'error');
        return;
      }

      if (updateSyllabusStatus) updateSyllabusStatus.textContent = 'Uploading new syllabus...';

      try {
        const uploadedSyllabus = await uploadAsset(syllabusFile, 'syllabus');
        await api(`/teacher/subjects/${syllabusUpdateSubjectId}/syllabus`, {
          method: 'PATCH',
          body: JSON.stringify({
            syllabusPdfUrl: uploadedSyllabus.url,
            syllabusPdfName: syllabusFile.name
          })
        });
        if (updateSyllabusStatus) updateSyllabusStatus.textContent = 'Syllabus updated successfully.';
        showToast('Syllabus updated.', 'success');
        void renderTeacherDashboard();
      } catch (error) {
        if (updateSyllabusStatus) {
          updateSyllabusStatus.textContent =
            error.message ||
            'Upload failed. Configure Cloudinary in production for reliable PDF uploads.';
        }
        showToast(error.message || 'Could not upload syllabus.', 'error');
      }
    });
  }

  document.querySelectorAll('[data-delete-subject]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this subject?')) return;
      const subjectId = button.getAttribute('data-delete-subject');
      if (!subjectId) return;

      await withButtonLoading(button, 'Deleting...', async () => {
        try {
          await api(`/teacher/subjects/${subjectId}`, { method: 'DELETE' });
          showToast('Subject deleted.', 'success');
          void renderTeacherDashboard();
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  });

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
      void renderTeacherDashboard();
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
      const values = Array.from(document.querySelectorAll('[data-test-target-student]')).map((item) =>
        item.getAttribute('data-test-target-student')
      );
      state.teacherTestSelectedStudentIds = values.filter(Boolean);
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
          const type = document.getElementById('testType').value;
          const durationMinutes = Number(document.getElementById('testDuration').value || 60);
          const audienceMode = document.getElementById('testAudienceMode')?.value || 'all';
          const selectedStudentIds =
            audienceMode === 'selected'
              ? Array.from(document.querySelectorAll('[data-test-target-student]:checked'))
                  .map((item) => item.getAttribute('data-test-target-student'))
                  .filter(Boolean)
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

          let questions = [];
          if (type === 'mcq' || type === 'true_false') {
            questions = collectObjectiveQuestions(type);
          } else {
            const rawQuestions = document.getElementById('testQuestionsInput').value;
            questions = parseLongQuestions(rawQuestions);
          }

          await api('/teacher/tests', {
            method: 'POST',
            body: JSON.stringify({
              subjectId,
              title,
              type,
              durationMinutes:
                type === 'mcq' || type === 'true_false'
                  ? MCQ_DURATION_MINUTES
                  : durationMinutes,
              audienceMode,
              selectedStudentIds,
              sourcePdfName: '',
              questions
            })
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
}

function buildAnswerKeyText(payload) {
  const lines = [`Answer Key: ${payload.title || 'Test'}`, ''];
  (payload.answerKey || []).forEach((item) => {
    lines.push(`${item.questionNumber}. ${item.question}`);
    lines.push(`Correct: ${item.correctAnswer}`);
    lines.push('');
  });
  return lines.join('\n');
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
            test.type === 'mcq' || test.type === 'true_false'
              ? '<button class="cta-soft" id="downloadAnswerKeyBtn">Download Answer Key</button>'
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

  const answerKeyBtn = document.getElementById('downloadAnswerKeyBtn');
  if (answerKeyBtn) {
    answerKeyBtn.addEventListener('click', async () => {
      await withButtonLoading(answerKeyBtn, 'Downloading...', async () => {
        try {
          const result = await api(`/student/tests/attempts/${attempt._id}/answer-key`);
          downloadTextFile(
            `${(test.title || 'test').replace(/\s+/g, '-').toLowerCase()}-answer-key.txt`,
            buildAnswerKeyText(result.data)
          );
          showToast('Answer key downloaded.', 'success');
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
      if (test.type === 'mcq' || test.type === 'true_false') {
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
      if (test.type === 'mcq' || test.type === 'true_false') {
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
                        ${
                          item.source === 'file'
                            ? `<a href="${escapeHtml(item.value)}" download="${escapeHtml(item.title || 'resource')}">Download Resource</a>`
                            : `<a href="${escapeHtml(item.value)}" target="_blank" rel="noreferrer">Open Resource</a>`
                        }
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

  const [meData, dashboardResult, historyResult, queueResult, todayClassesResult] =
    await Promise.all([
      fetchMe(),
      api('/student/dashboard'),
      api('/student/tests/history'),
      api('/student/tests/queue'),
      api('/student/classes/today')
    ]);

  const user = meData.user;
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
          ${navButtonsMarkup(
            [
              { value: 'dashboard', label: 'Dashboard' },
              { value: 'today', label: "Today's Test" },
              { value: 'pending', label: 'Pending Tests' },
              { value: 'classes', label: "Today's Classes" },
              { value: 'resources', label: 'Resources' },
              { value: 'syllabus', label: 'Syllabus' },
              { value: 'history', label: 'Test History' },
              { value: 'planner', label: 'Study To-Do' },
              { value: 'accounts', label: 'Accounts' }
            ],
            state.studentTab,
            'data-student-tab'
          )}
        </div>
        <button class="signout" id="logoutBtn">Sign Out</button>
      </header>

      <main class="page container-xl">
        <h2>Good Day, ${escapeHtml(user.fullName)} 👋</h2>
        <p class="subline">Institution ID: ${escapeHtml(meData.institution?.institutionId || state.session.institutionId)}</p>

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
                  <button class="cta-soft action-btn" data-student-nav="resources">Download Resources</button>
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
                              </div>
                              <button class="cta-main" data-start-test="${test._id}" data-test-source="today">Start Test</button>
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
                              </div>
                              <button class="cta-main" data-start-test="${test._id}" data-test-source="pending">Start Test</button>
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
                                  ? item.resource.source === 'file'
                                    ? `<a href="${escapeHtml(item.resource.value)}" download="${escapeHtml(item.resource.title || 'resource')}">Download Class Resource</a>`
                                    : `<a href="${escapeHtml(item.resource.value)}" target="_blank" rel="noreferrer">Open Class Resource</a>`
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
                                  item.syllabusPdfUrl
                                    ? `<a href="${escapeHtml(item.syllabusPdfUrl)}" target="_blank" rel="noreferrer">Open PDF</a>`
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
                                        item.type === 'mcq' || item.type === 'true_false'
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
      </main>
    </div>
  `;

  bindTabButtons('[data-student-tab]', (button) => {
    state.studentTab = button.getAttribute('data-student-tab') || 'dashboard';
    void renderStudentDashboard();
  });

  document.querySelectorAll('[data-student-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      state.studentTab = button.getAttribute('data-student-nav') || 'dashboard';
      void renderStudentDashboard();
    });
  });

  document.getElementById('logoutBtn').addEventListener('click', logout);

  document.querySelectorAll('[data-start-test]').forEach((button) => {
    button.addEventListener('click', () => {
      const testId = button.getAttribute('data-start-test');
      const source = button.getAttribute('data-test-source') || 'today';
      const test = testMap.get(testId);
      if (!test) return;
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

      await withButtonLoading(button, 'Downloading...', async () => {
        try {
          const result = await api(`/student/tests/attempts/${attemptId}/answer-key`);
          downloadTextFile(
            `${String(title).replace(/\s+/g, '-').toLowerCase()}-answer-key.txt`,
            buildAnswerKeyText(result.data)
          );
          showToast('Answer key downloaded.', 'success');
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  });

  bindAccountPasswordForm();
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
