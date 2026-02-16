const app = document.getElementById('app');

const SESSION_KEY = 'lift_live_session_v2';
const API_CANDIDATE_PORTS = Array.from({ length: 21 }, (_, index) => 5050 + index);

const runtime = {
  attemptTimerId: null,
  attemptSubmitting: false
};

const state = {
  apiBase: '',
  apiResolved: false,
  session: loadSession(),
  adminTab: 'dashboard',
  teacherTab: 'dashboard',
  studentTab: 'dashboard',
  adminStudentQuery: '',
  adminSubjectFilter: '',
  adminMessageUserId: '',
  teacherStudentQuery: '',
  teacherSubjectFilter: '',
  teacherResourceSearch: '',
  teacherResourceType: '',
  teacherResourceSubjectId: '',
  teacherMessageStudentId: '',
  teacherTestSubjectId: '',
  teacherTestType: 'mcq',
  studentResourceSearch: '',
  studentResourceType: '',
  studentResourceSubjectId: '',
  studentMessageTeacherId: '',
  studentSyllabusSubjectId: ''
};

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.token || !parsed.user || !parsed.institutionId) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function saveSession(session) {
  state.session = session;
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function resetUiStateOnLogout() {
  state.adminTab = 'dashboard';
  state.teacherTab = 'dashboard';
  state.studentTab = 'dashboard';
  state.adminStudentQuery = '';
  state.adminSubjectFilter = '';
  state.adminMessageUserId = '';
  state.teacherStudentQuery = '';
  state.teacherSubjectFilter = '';
  state.teacherResourceSearch = '';
  state.teacherResourceType = '';
  state.teacherResourceSubjectId = '';
  state.teacherMessageStudentId = '';
  state.teacherTestSubjectId = '';
  state.teacherTestType = 'mcq';
  state.studentResourceSearch = '';
  state.studentResourceType = '';
  state.studentResourceSubjectId = '';
  state.studentMessageTeacherId = '';
  state.studentSyllabusSubjectId = '';
}

function clearAttemptTimer() {
  if (runtime.attemptTimerId) {
    clearInterval(runtime.attemptTimerId);
    runtime.attemptTimerId = null;
  }
  runtime.attemptSubmitting = false;
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

function notificationsMarkup(notifications) {
  if (!notifications.length) {
    return '<p class="muted">No new notifications.</p>';
  }

  return `
    <div class="stack">
      ${notifications
        .slice(0, 6)
        .map(
          (item) => `
            <p class="stack-item">${escapeHtml(item.message)}<br /><small>${formatDate(item.createdAt)}</small></p>
          `
        )
        .join('')}
    </div>
  `;
}

function messageFeedMarkup(messages, currentUserId) {
  if (!messages.length) return '<p class="muted">No messages yet.</p>';

  return `
    <div class="social-feed">
      ${messages
        .map((item) => {
          const mine = item.fromUserId === currentUserId;
          const senderName = item.fromUser?.fullName || item.fromUser?.username || 'User';
          return `
            <article class="feed-card ${mine ? 'mine' : ''}">
              <div class="feed-meta">
                <strong>${escapeHtml(senderName)}</strong>
                <small>${formatDate(item.createdAt)}</small>
              </div>
              <p>${escapeHtml(item.text)}</p>
            </article>
          `;
        })
        .join('')}
    </div>
  `;
}

function parseMcqQuestions(raw) {
  const lines = String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== 20) {
    throw new Error('MCQ requires exactly 20 lines/questions.');
  }

  return lines.map((line, index) => {
    const parts = line
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length < 4) {
      throw new Error(`Line ${index + 1} format is invalid.`);
    }

    const question = parts[0];
    const correctValue = parts[parts.length - 1];
    const options = parts.slice(1, -1);
    const correctIndex = Number(correctValue) - 1;

    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      throw new Error(`Line ${index + 1} correct option index is invalid.`);
    }

    return {
      text: question,
      options,
      correctIndex
    };
  });
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

async function resolveApiBase() {
  if (state.apiResolved) return state.apiBase;

  try {
    const sameOriginBase = `${window.location.origin}/api`;
    const response = await fetch(`${sameOriginBase}/health`, { method: 'GET' });
    if (response.ok) {
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

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    payload = { success: false, message: 'Invalid server response.' };
  }

  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || 'Request failed');
  }

  return payload;
}

async function markAllNotificationsRead(rolePath) {
  await api(`/${rolePath}/notifications/read`, {
    method: 'POST',
    body: JSON.stringify({})
  });
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
    status.textContent = 'Updating password...';

    try {
      const currentPassword = document.getElementById('currentPassword').value;
      const newPassword = document.getElementById('newPassword').value;

      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });

      status.textContent = 'Password changed successfully.';
      form.reset();
    } catch (error) {
      status.textContent = error.message;
    }
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
          <button class="hero-btn student" id="studentSignInBtn">I'm a Student</button>
          <button class="hero-btn teacher" id="teacherSignInBtn">I'm a Teacher</button>
          <button class="hero-btn admin" id="adminSignInBtn">I'm an Admin</button>
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
            <input id="institutionId" type="text" required />

            <label for="username">Username</label>
            <input id="username" type="text" required />

            <label for="password">Password</label>
            <input id="password" type="password" required />

            <button type="submit" class="cta-main auth-submit">Sign In</button>
            ${
              role === 'student'
                ? '<button type="button" class="set-password-btn" id="firstTimeSetPasswordBtn">First time? Set Password</button>'
                : ''
            }
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
    status.textContent = 'Signing in...';

    try {
      const institutionId = document.getElementById('institutionId').value.trim();
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;

      const result = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ institutionId, username, password })
      });

      if (result.data.user.role !== role) {
        status.textContent = `This account is ${roleLabel(result.data.user.role)}. Use correct login.`;
        return;
      }

      saveSession({
        token: result.data.token,
        user: result.data.user,
        institutionId
      });

      if (role === 'student' && result.data.user.mustChangePassword) {
        status.textContent = 'First-time account detected. Click “First time? Set Password”.';
        return;
      }

      await renderByRole();
    } catch (error) {
      status.textContent = error.message;
    }
  });

  document.getElementById('backBtn').addEventListener('click', renderWelcome);

  if (role === 'student') {
    document
      .getElementById('firstTimeSetPasswordBtn')
      .addEventListener('click', renderStudentFirstTimePassword);
  }
}

function renderStudentFirstTimePassword() {
  clearAttemptTimer();

  app.innerHTML = `
    <section class="welcome-page live-welcome">
      <div class="hero-overlay"></div>
      <div class="hero-content">
        <header class="hero-header">${logoMarkup()}</header>

        <div class="auth-card live-auth-card">
          <h2 class="auth-title">Set Student Password</h2>
          <p class="auth-subtitle">Use temporary password shared by your teacher.</p>

          <form id="firstTimePasswordForm" class="auth-form">
            <label for="institutionId">Institution ID</label>
            <input id="institutionId" type="text" required />

            <label for="username">Username</label>
            <input id="username" type="text" required />

            <label for="temporaryPassword">Temporary Password</label>
            <input id="temporaryPassword" type="password" required />

            <label for="newPassword">New Password</label>
            <input id="newPassword" type="password" minlength="6" required />

            <label for="confirmPassword">Confirm New Password</label>
            <input id="confirmPassword" type="password" minlength="6" required />

            <button class="cta-main auth-submit" type="submit">Save Password</button>
            <button class="back-link-btn" id="backToStudentLoginBtn" type="button">Back to Student Login</button>
          </form>

          <p class="auth-note" id="firstTimeStatus"></p>
        </div>
      </div>
      <footer class="hero-footer">Developed by LIFT Educations</footer>
    </section>
  `;

  document
    .getElementById('firstTimePasswordForm')
    .addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = document.getElementById('firstTimeStatus');
      status.textContent = 'Saving password...';

      try {
        const institutionId = document.getElementById('institutionId').value.trim();
        const username = document.getElementById('username').value.trim();
        const temporaryPassword = document.getElementById('temporaryPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (newPassword !== confirmPassword) {
          status.textContent = 'Passwords do not match.';
          return;
        }

        await api('/auth/set-password-first-time', {
          method: 'POST',
          body: JSON.stringify({
            institutionId,
            username,
            temporaryPassword,
            newPassword
          })
        });

        status.textContent = 'Password updated. Login now.';
      } catch (error) {
        status.textContent = error.message;
      }
    });

  document
    .getElementById('backToStudentLoginBtn')
    .addEventListener('click', () => renderLogin('student'));
}

async function renderAdminDashboard() {
  clearAttemptTimer();

  const [meData, summaryResult, teachersResult, subjectsResult, notificationsResult] =
    await Promise.all([
      fetchMe(),
      api('/admin/summary'),
      api('/admin/teachers'),
      api('/admin/subjects'),
      api('/admin/notifications')
    ]);

  const studentsQuery = toQueryString({
    q: state.adminStudentQuery,
    subjectId: state.adminSubjectFilter
  });
  const studentsResult = await api(`/admin/students${studentsQuery}`);

  let messageUsers = [];
  let messageFeed = [];
  if (state.adminTab === 'messages') {
    const usersResult = await api('/admin/users');
    messageUsers = usersResult.data.users || [];

    if (!state.adminMessageUserId && messageUsers.length) {
      state.adminMessageUserId = messageUsers[0]._id;
    }

    if (state.adminMessageUserId) {
      const conversationResult = await api(
        `/admin/messages${toQueryString({ userId: state.adminMessageUserId })}`
      );
      messageFeed = conversationResult.data.messages || [];
    }
  }

  const user = meData.user;
  const summary = summaryResult.data.summary;
  const teachers = teachersResult.data.teachers || [];
  const students = studentsResult.data.students || [];
  const subjects = subjectsResult.data.subjects || [];
  const notifications = notificationsResult.data.notifications || [];
  const unreadCount = notifications.filter((item) => !item.read).length;

  app.innerHTML = `
    <div class="dashboard-shell">
      <header class="main-nav">
        <div class="left-nav">
          ${logoMarkup(true)}
          ${navButtonsMarkup(
            [
              { value: 'dashboard', label: 'Dashboard' },
              { value: 'teachers', label: 'Teachers' },
              { value: 'students', label: 'Students' },
              { value: 'messages', label: 'Messages' },
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

        <section class="panel">
          <div class="progress-row">
            <h3>Notifications</h3>
            <strong>${unreadCount} unread</strong>
          </div>
          ${notificationsMarkup(notifications)}
          <button id="adminMarkNotificationsBtn" class="cta-soft">Mark all read</button>
        </section>

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
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Username</th>
                        <th>Email</th>
                        <th>Phone</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        teachers.length
                          ? teachers
                              .map(
                                (teacher) => `
                                  <tr>
                                    <td>${escapeHtml(teacher.fullName)}</td>
                                    <td>${escapeHtml(teacher.username)}</td>
                                    <td>${escapeHtml(teacher.email || '-')}</td>
                                    <td>${escapeHtml(teacher.phone || '-')}</td>
                                  </tr>
                                `
                              )
                              .join('')
                          : '<tr><td colspan="4">No teachers yet.</td></tr>'
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

        ${
          state.adminTab === 'messages'
            ? `
              <section class="panel">
                <h3>Message Users</h3>
                <label for="adminMessageUserId">Choose Recipient</label>
                <select id="adminMessageUserId">
                  ${messageUsers
                    .map(
                      (item) =>
                        `<option value="${item._id}" ${
                          state.adminMessageUserId === item._id ? 'selected' : ''
                        }>${escapeHtml(item.fullName)} (${escapeHtml(item.role)})</option>`
                    )
                    .join('')}
                </select>

                <label for="adminMessageText">Message</label>
                <textarea id="adminMessageText" rows="4" placeholder="Type message for selected user"></textarea>
                <button id="adminSendMessageBtn" class="cta-main">Send Message</button>
                <p class="auth-note" id="adminMessageStatus"></p>
              </section>

              <section class="panel">
                <h3>Conversation</h3>
                ${messageFeedMarkup(messageFeed, user.id)}
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

  document.getElementById('adminMarkNotificationsBtn').addEventListener('click', async () => {
    try {
      await markAllNotificationsRead('admin');
      void renderAdminDashboard();
    } catch (error) {
      alert(error.message);
    }
  });

  const createTeacherBtn = document.getElementById('createTeacherBtn');
  if (createTeacherBtn) {
    createTeacherBtn.addEventListener('click', async () => {
      const status = document.getElementById('createTeacherStatus');
      status.textContent = 'Creating teacher...';

      try {
        const payload = {
          fullName: document.getElementById('teacherFullName').value.trim(),
          username: document.getElementById('teacherUsername').value.trim(),
          password: document.getElementById('teacherPassword').value,
          email: document.getElementById('teacherEmail').value.trim(),
          phone: document.getElementById('teacherPhone').value.trim()
        };

        await api('/admin/teachers', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        status.textContent = 'Teacher account created.';
        void renderAdminDashboard();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }

  const searchInput = document.getElementById('adminStudentSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      state.adminStudentQuery = event.target.value;
      void renderAdminDashboard();
    });
  }

  const subjectFilter = document.getElementById('adminSubjectFilter');
  if (subjectFilter) {
    subjectFilter.addEventListener('change', (event) => {
      state.adminSubjectFilter = event.target.value;
      void renderAdminDashboard();
    });
  }

  const recipientSelect = document.getElementById('adminMessageUserId');
  if (recipientSelect) {
    recipientSelect.addEventListener('change', (event) => {
      state.adminMessageUserId = event.target.value;
      void renderAdminDashboard();
    });
  }

  const adminSendMessageBtn = document.getElementById('adminSendMessageBtn');
  if (adminSendMessageBtn) {
    adminSendMessageBtn.addEventListener('click', async () => {
      const status = document.getElementById('adminMessageStatus');
      status.textContent = 'Sending...';

      try {
        const toUserId = document.getElementById('adminMessageUserId').value;
        const text = document.getElementById('adminMessageText').value.trim();
        if (!toUserId || !text) {
          status.textContent = 'Choose recipient and type message.';
          return;
        }

        await api('/admin/messages', {
          method: 'POST',
          body: JSON.stringify({ toUserId, text })
        });

        status.textContent = 'Message sent.';
        document.getElementById('adminMessageText').value = '';
        void renderAdminDashboard();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }

  bindAccountPasswordForm();
}

async function renderTeacherDashboard() {
  clearAttemptTimer();

  const [meData, subjectsResult, notificationsResult] = await Promise.all([
    fetchMe(),
    api('/teacher/subjects'),
    api('/teacher/notifications')
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

  const studentQuery = toQueryString({
    q: state.teacherStudentQuery,
    subjectId: state.teacherSubjectFilter
  });
  const studentsResult = await api(`/teacher/students${studentQuery}`);
  const students = studentsResult.data.students || [];

  let resources = [];
  if (state.teacherTab === 'resources') {
    const resourcesQuery = toQueryString({
      subjectId: state.teacherResourceSubjectId,
      resourceType: state.teacherResourceType,
      q: state.teacherResourceSearch
    });
    const resourceResult = await api(`/teacher/resources${resourcesQuery}`);
    resources = resourceResult.data.resources || [];
  }

  let tests = [];
  if (state.teacherTab === 'tests') {
    const testsQuery = toQueryString({
      subjectId: state.teacherTestSubjectId
    });
    const testsResult = await api(`/teacher/tests${testsQuery}`);
    tests = testsResult.data.tests || [];
  }

  let conversation = [];
  if (state.teacherTab === 'messages') {
    if (!state.teacherMessageStudentId && students.length) {
      state.teacherMessageStudentId = students[0]._id;
    }

    if (state.teacherMessageStudentId) {
      const conversationResult = await api(
        `/teacher/messages${toQueryString({ studentId: state.teacherMessageStudentId })}`
      );
      conversation = conversationResult.data.messages || [];
    }
  }

  const user = meData.user;
  const notifications = notificationsResult.data.notifications || [];
  const unreadCount = notifications.filter((item) => !item.read).length;

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
              { value: 'resources', label: 'Upload Resources' },
              { value: 'tests', label: 'Conduct Test' },
              { value: 'messages', label: 'Messages' },
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
        <p class="subline">Manage subjects, students, tests and resources from one place.</p>

        <section class="panel">
          <div class="progress-row">
            <h3>Notifications</h3>
            <strong>${unreadCount} unread</strong>
          </div>
          ${notificationsMarkup(notifications)}
          <button id="teacherMarkNotificationsBtn" class="cta-soft">Mark all read</button>
        </section>

        ${
          state.teacherTab === 'dashboard'
            ? `
              <section class="stats-grid">
                <article class="panel stat"><h3>${subjects.length}</h3><p>Subjects</p></article>
                <article class="panel stat"><h3>${students.length}</h3><p>Students</p></article>
                <article class="panel stat"><h3>${students.filter((item) => item.mustChangePassword).length}</h3><p>Pending Password Setup</p></article>
                <article class="panel stat"><h3>${students.filter((item) => item.email).length}</h3><p>Students with Email</p></article>
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
                    <label for="syllabusPdfUrl">Syllabus PDF URL</label>
                    <input id="syllabusPdfUrl" type="url" placeholder="https://...pdf" required />
                  </div>
                  <div>
                    <label for="syllabusPdfName">Syllabus File Name</label>
                    <input id="syllabusPdfName" type="text" />
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
                                        ? `<a href="${escapeHtml(subject.syllabusPdfUrl)}" target="_blank" rel="noreferrer">View PDF</a>`
                                        : '-'
                                    }</td>
                                    <td>${formatDate(subject.createdAt)}</td>
                                    <td><button class="mini-btn danger" data-delete-subject="${subject._id}">Delete</button></td>
                                  </tr>
                                `
                              )
                              .join('')
                          : '<tr><td colspan="4">No subjects yet.</td></tr>'
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
                                const shareText = encodeURIComponent(
                                  `LIFT Educations login\nInstitution ID: ${state.session.institutionId}\nUsername: ${student.username}`
                                );
                                const subjectsText = (student.subjects || [])
                                  .map((item) => item.name)
                                  .filter(Boolean)
                                  .join(', ');
                                return `
                                  <tr>
                                    <td>${escapeHtml(student.fullName)}</td>
                                    <td>${escapeHtml(student.username)}</td>
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
                          : '<tr><td colspan="7">No students found.</td></tr>'
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
                      <option value="pdf">PDF</option>
                      <option value="ebook">EBook</option>
                      <option value="video">Video</option>
                      <option value="link">Link</option>
                    </select>
                  </div>
                  <div>
                    <label for="resourceTitle">Title</label>
                    <input id="resourceTitle" type="text" required />
                  </div>
                  <div>
                    <label for="resourceValue">Resource URL / Text</label>
                    <input id="resourceValue" type="text" required />
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
                        <th>Link / Value</th>
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
                                    <td><a href="${escapeHtml(resource.value)}" target="_blank" rel="noreferrer">Open</a></td>
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
                      <option value="mcq" ${state.teacherTestType === 'mcq' ? 'selected' : ''}>MCQ (20 Questions)</option>
                      <option value="long" ${state.teacherTestType === 'long' ? 'selected' : ''}>Long Format</option>
                    </select>
                  </div>
                  <div>
                    <label for="testDuration">Duration Minutes (Long only)</label>
                    <select id="testDuration">
                      <option value="60">60</option>
                      <option value="90">90</option>
                      <option value="120">120</option>
                    </select>
                  </div>
                </form>

                <label for="testQuestionsInput">${
                  state.teacherTestType === 'mcq'
                    ? 'MCQ format per line: Question|Option A|Option B|Option C|Option D|Correct Option Number'
                    : 'Long questions: one question per line'
                }</label>
                <textarea id="testQuestionsInput" rows="8" placeholder="${
                  state.teacherTestType === 'mcq'
                    ? 'Q1 text|A|B|C|D|2'
                    : 'Write question 1 on first line'
                }"></textarea>

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
                                    <td>${escapeHtml(test.type.toUpperCase())}</td>
                                    <td>${escapeHtml(test.durationMinutes)} min</td>
                                    <td>${formatDate(test.createdAt)}</td>
                                  </tr>
                                `
                              )
                              .join('')
                          : '<tr><td colspan="4">No tests published.</td></tr>'
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            `
            : ''
        }

        ${
          state.teacherTab === 'messages'
            ? `
              <section class="panel">
                <h3>Message Student</h3>
                <label for="teacherMessageStudentId">Choose Student</label>
                <select id="teacherMessageStudentId">
                  ${students
                    .map(
                      (student) =>
                        `<option value="${student._id}" ${
                          state.teacherMessageStudentId === student._id ? 'selected' : ''
                        }>${escapeHtml(student.fullName)}</option>`
                    )
                    .join('')}
                </select>

                <label for="teacherMessageText">Message</label>
                <textarea id="teacherMessageText" rows="4" placeholder="Type message"></textarea>
                <button id="teacherSendMessageBtn" class="cta-main">Send</button>
                <p class="auth-note" id="teacherMessageStatus"></p>
              </section>

              <section class="panel">
                <h3>Conversation</h3>
                ${messageFeedMarkup(conversation, user.id)}
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

  document
    .getElementById('teacherMarkNotificationsBtn')
    .addEventListener('click', async () => {
      try {
        await markAllNotificationsRead('teacher');
        void renderTeacherDashboard();
      } catch (error) {
        alert(error.message);
      }
    });

  const createSubjectBtn = document.getElementById('createSubjectBtn');
  if (createSubjectBtn) {
    createSubjectBtn.addEventListener('click', async () => {
      const status = document.getElementById('createSubjectStatus');
      status.textContent = 'Creating subject...';

      try {
        const payload = {
          name: document.getElementById('subjectName').value.trim(),
          syllabusPdfUrl: document.getElementById('syllabusPdfUrl').value.trim(),
          syllabusPdfName: document.getElementById('syllabusPdfName').value.trim()
        };

        await api('/teacher/subjects', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        status.textContent = 'Subject created.';
        void renderTeacherDashboard();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }

  document.querySelectorAll('[data-delete-subject]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this subject?')) return;
      const subjectId = button.getAttribute('data-delete-subject');
      if (!subjectId) return;

      try {
        await api(`/teacher/subjects/${subjectId}`, { method: 'DELETE' });
        void renderTeacherDashboard();
      } catch (error) {
        alert(error.message);
      }
    });
  });

  const createStudentBtn = document.getElementById('createStudentBtn');
  if (createStudentBtn) {
    createStudentBtn.addEventListener('click', async () => {
      const status = document.getElementById('createStudentStatus');
      status.textContent = 'Creating student...';

      try {
        const selectedSubjects = Array.from(
          document.getElementById('studentSubjects').selectedOptions
        ).map((option) => option.value);

        if (!selectedSubjects.length) {
          status.textContent = 'Select at least one subject.';
          return;
        }

        const payload = {
          fullName: document.getElementById('studentFullName').value.trim(),
          username: document.getElementById('studentUsername').value.trim(),
          password: document.getElementById('studentTempPassword').value,
          email: document.getElementById('studentEmail').value.trim(),
          phone: document.getElementById('studentPhone').value.trim(),
          subjectIds: selectedSubjects
        };

        const result = await api('/teacher/students', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        status.textContent = 'Student account created.';
        alert(
          `Student created:\nInstitution ID: ${state.session.institutionId}\nUsername: ${result.data.student.username}\nTemporary Password: ${payload.password}`
        );
        void renderTeacherDashboard();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }

  const searchInput = document.getElementById('teacherStudentSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      state.teacherStudentQuery = event.target.value;
      void renderTeacherDashboard();
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

      try {
        await api(`/teacher/students/${studentId}`, { method: 'DELETE' });
        void renderTeacherDashboard();
      } catch (error) {
        alert(error.message);
      }
    });
  });

  const createResourceBtn = document.getElementById('createResourceBtn');
  if (createResourceBtn) {
    createResourceBtn.addEventListener('click', async () => {
      const status = document.getElementById('createResourceStatus');
      status.textContent = 'Uploading resource...';

      try {
        const payload = {
          subjectId: document.getElementById('resourceSubjectId').value,
          resourceType: document.getElementById('resourceType').value,
          title: document.getElementById('resourceTitle').value.trim(),
          value: document.getElementById('resourceValue').value.trim(),
          source: 'text',
          keywords: document.getElementById('resourceKeywords').value.trim()
        };

        if (!payload.subjectId || !payload.title || !payload.value) {
          status.textContent = 'Subject, title and value are required.';
          return;
        }

        await api('/teacher/resources', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        status.textContent = 'Resource uploaded.';
        void renderTeacherDashboard();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }

  const teacherResourceSearch = document.getElementById('teacherResourceSearch');
  if (teacherResourceSearch) {
    teacherResourceSearch.addEventListener('input', (event) => {
      state.teacherResourceSearch = event.target.value;
      void renderTeacherDashboard();
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

      try {
        await api(`/teacher/resources/${resourceId}`, { method: 'DELETE' });
        void renderTeacherDashboard();
      } catch (error) {
        alert(error.message);
      }
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
      state.teacherTestSubjectId = event.target.value;
    });
  }

  const createTestBtn = document.getElementById('createTestBtn');
  if (createTestBtn) {
    createTestBtn.addEventListener('click', async () => {
      const status = document.getElementById('createTestStatus');
      status.textContent = 'Publishing test...';

      try {
        const subjectId = document.getElementById('testSubjectId').value;
        const title = document.getElementById('testTitle').value.trim();
        const type = document.getElementById('testType').value;
        const durationMinutes = Number(document.getElementById('testDuration').value || 60);
        const rawQuestions = document.getElementById('testQuestionsInput').value;

        if (!subjectId || !title) {
          status.textContent = 'Subject and title are required.';
          return;
        }

        const questions = type === 'mcq' ? parseMcqQuestions(rawQuestions) : parseLongQuestions(rawQuestions);
        await api('/teacher/tests', {
          method: 'POST',
          body: JSON.stringify({
            subjectId,
            title,
            type,
            durationMinutes,
            questions
          })
        });

        status.textContent = 'Test published.';
        void renderTeacherDashboard();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }

  const teacherMessageStudentId = document.getElementById('teacherMessageStudentId');
  if (teacherMessageStudentId) {
    teacherMessageStudentId.addEventListener('change', (event) => {
      state.teacherMessageStudentId = event.target.value;
      void renderTeacherDashboard();
    });
  }

  const teacherSendMessageBtn = document.getElementById('teacherSendMessageBtn');
  if (teacherSendMessageBtn) {
    teacherSendMessageBtn.addEventListener('click', async () => {
      const status = document.getElementById('teacherMessageStatus');
      status.textContent = 'Sending...';

      try {
        const toUserId = document.getElementById('teacherMessageStudentId').value;
        const text = document.getElementById('teacherMessageText').value.trim();
        if (!toUserId || !text) {
          status.textContent = 'Choose student and type message.';
          return;
        }

        await api('/teacher/messages', {
          method: 'POST',
          body: JSON.stringify({ toUserId, text })
        });

        status.textContent = 'Message sent.';
        document.getElementById('teacherMessageText').value = '';
        void renderTeacherDashboard();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }

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
          <p class="subline">${escapeHtml(test.type.toUpperCase())} | ${escapeHtml(test.subjectName || '')}</p>
          <p class="headline">${scoreText}</p>
          <p class="muted">Time spent: ${Math.round((attempt.timeSpentSeconds || 0) / 60)} minutes</p>

          ${
            test.type === 'mcq'
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
      try {
        const result = await api(`/student/tests/attempts/${attempt._id}/answer-key`);
        downloadTextFile(
          `${(test.title || 'test').replace(/\s+/g, '-').toLowerCase()}-answer-key.txt`,
          buildAnswerKeyText(result.data)
        );
      } catch (error) {
        alert(error.message);
      }
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
      if (test.type === 'mcq') {
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
          <span class="nav-pill active">${escapeHtml(test.type.toUpperCase())} Attempt</span>
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
      if (test.type === 'mcq') {
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
                        <a href="${escapeHtml(item.value)}" target="_blank" rel="noreferrer">Open Resource</a>
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

async function renderStudentDashboard() {
  clearAttemptTimer();

  const [meData, dashboardResult, historyResult, queueResult, teachersResult, notificationsResult] =
    await Promise.all([
      fetchMe(),
      api('/student/dashboard'),
      api('/student/tests/history'),
      api('/student/tests/queue'),
      api('/student/teachers'),
      api('/student/notifications')
    ]);

  const user = meData.user;
  const dashboard = dashboardResult.data.dashboard;
  const history = historyResult.data.history || [];
  const todayTests = queueResult.data.today || [];
  const pendingTests = queueResult.data.pending || [];
  const teachers = teachersResult.data.teachers || [];
  const notifications = notificationsResult.data.notifications || [];
  const unreadCount = notifications.filter((item) => !item.read).length;

  if (!state.studentMessageTeacherId && teachers.length) {
    state.studentMessageTeacherId = teachers[0]._id;
  }

  const subjects = dashboard.subjects || [];

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

  let conversation = [];
  if (state.studentTab === 'messages' && state.studentMessageTeacherId) {
    const conversationResult = await api(
      `/student/messages${toQueryString({ teacherId: state.studentMessageTeacherId })}`
    );
    conversation = conversationResult.data.messages || [];
  }

  const progressPercent = Math.min(100, Math.round((history.length / 20) * 100));

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
              { value: 'messages', label: 'Messages' },
              { value: 'resources', label: 'Resources' },
              { value: 'syllabus', label: 'Syllabus' },
              { value: 'history', label: 'Test History' },
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

        <section class="panel">
          <div class="progress-row">
            <h3>Notifications</h3>
            <strong>${unreadCount} unread</strong>
          </div>
          ${notificationsMarkup(notifications)}
          <button id="studentMarkNotificationsBtn" class="cta-soft">Mark all read</button>
        </section>

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
                  <p class="muted">${todayTests.length ? `${escapeHtml(todayTests[0].type.toUpperCase())} | ${escapeHtml(todayTests[0].durationMinutes)} min` : 'Please check later.'}</p>
                  <button class="cta-main" data-student-nav="today">Open Today's Tests</button>
                </article>

                <article class="panel">
                  <h3>Today's Chapter</h3>
                  <p class="headline">${subjects.length ? escapeHtml(subjects[0].name) : 'No subjects assigned'}</p>
                  <p class="muted">Read guide and notes before attempting tests.</p>
                  <button class="cta-soft" data-student-nav="resources">Open Resources</button>
                </article>
              </section>

              <section class="panel student-actions-panel">
                <h3>Quick Actions</h3>
                <div class="student-actions-grid">
                  <button class="cta-soft action-btn" data-student-nav="messages">Message Teacher</button>
                  <button class="cta-soft action-btn" data-student-nav="resources">Download Resources</button>
                  <button class="cta-soft action-btn" data-student-nav="syllabus">View Syllabus</button>
                  <button class="cta-soft action-btn" data-student-nav="history">View Scores</button>
                </div>
              </section>

              <section class="panel">
                <h3>Course Progress</h3>
                <div class="progress-row">
                  <p>Overall completion</p>
                  <strong>${progressPercent}%</strong>
                </div>
                <div class="progress-track">
                  <div class="progress-fill" style="width: ${progressPercent}%"></div>
                </div>
                <p class="muted">Subjects Enrolled: ${dashboard.subjectCount} | Tests Attempted: ${dashboard.attemptCount}</p>
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
                                <p class="muted">${escapeHtml(test.subjectName || '')} | ${escapeHtml(test.type.toUpperCase())} | ${escapeHtml(test.durationMinutes)} min</p>
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
                                <p class="muted">${escapeHtml(test.subjectName || '')} | ${escapeHtml(test.type.toUpperCase())} | ${escapeHtml(test.durationMinutes)} min</p>
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
          state.studentTab === 'messages'
            ? `
              <section class="panel">
                <h3>Message Teacher</h3>
                <label for="studentMessageTeacherId">Choose Teacher</label>
                <select id="studentMessageTeacherId">
                  ${teachers
                    .map(
                      (teacher) =>
                        `<option value="${teacher._id}" ${
                          state.studentMessageTeacherId === teacher._id ? 'selected' : ''
                        }>${escapeHtml(teacher.fullName)}</option>`
                    )
                    .join('')}
                </select>

                <label for="studentMessageText">Message</label>
                <textarea id="studentMessageText" rows="4" placeholder="Type message"></textarea>
                <button id="studentSendMessageBtn" class="cta-main">Send</button>
                <p class="auth-note" id="studentMessageStatus"></p>
              </section>

              <section class="panel">
                <h3>Conversation</h3>
                ${messageFeedMarkup(conversation, user.id)}
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
                            `<option value="${subject.id}" ${
                              state.studentResourceSubjectId === subject.id ? 'selected' : ''
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
                                        item.type === 'mcq'
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

  document
    .getElementById('studentMarkNotificationsBtn')
    .addEventListener('click', async () => {
      try {
        await markAllNotificationsRead('student');
        void renderStudentDashboard();
      } catch (error) {
        alert(error.message);
      }
    });

  document.querySelectorAll('[data-start-test]').forEach((button) => {
    button.addEventListener('click', () => {
      const testId = button.getAttribute('data-start-test');
      const source = button.getAttribute('data-test-source') || 'today';
      const test = testMap.get(testId);
      if (!test) return;
      renderStudentTestAttempt(test, source === 'pending' ? 'pending' : 'today');
    });
  });

  const studentMessageTeacherId = document.getElementById('studentMessageTeacherId');
  if (studentMessageTeacherId) {
    studentMessageTeacherId.addEventListener('change', (event) => {
      state.studentMessageTeacherId = event.target.value;
      void renderStudentDashboard();
    });
  }

  const studentSendMessageBtn = document.getElementById('studentSendMessageBtn');
  if (studentSendMessageBtn) {
    studentSendMessageBtn.addEventListener('click', async () => {
      const status = document.getElementById('studentMessageStatus');
      status.textContent = 'Sending...';

      try {
        const toUserId = document.getElementById('studentMessageTeacherId').value;
        const text = document.getElementById('studentMessageText').value.trim();
        if (!toUserId || !text) {
          status.textContent = 'Choose teacher and type message.';
          return;
        }

        await api('/student/messages', {
          method: 'POST',
          body: JSON.stringify({ toUserId, text })
        });

        status.textContent = 'Message sent.';
        document.getElementById('studentMessageText').value = '';
        void renderStudentDashboard();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }

  const studentResourceSearch = document.getElementById('studentResourceSearch');
  if (studentResourceSearch) {
    studentResourceSearch.addEventListener('input', (event) => {
      state.studentResourceSearch = event.target.value;
      void renderStudentDashboard();
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

  document.querySelectorAll('[data-answer-key-attempt]').forEach((button) => {
    button.addEventListener('click', async () => {
      const attemptId = button.getAttribute('data-answer-key-attempt');
      const title = button.getAttribute('data-answer-key-title') || 'test';
      if (!attemptId) return;

      try {
        const result = await api(`/student/tests/attempts/${attemptId}/answer-key`);
        downloadTextFile(
          `${String(title).replace(/\s+/g, '-').toLowerCase()}-answer-key.txt`,
          buildAnswerKeyText(result.data)
        );
      } catch (error) {
        alert(error.message);
      }
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
