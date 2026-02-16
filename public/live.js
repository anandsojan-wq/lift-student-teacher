const app = document.getElementById('app');

const SESSION_KEY = 'lift_live_session_v1';
const API_CANDIDATE_PORTS = Array.from({ length: 21 }, (_, index) => 5050 + index);

const state = {
  apiBase: '',
  apiResolved: false,
  session: loadSession(),
  adminTab: 'dashboard',
  teacherTab: 'dashboard',
  studentTab: 'dashboard',
  teacherStudentQuery: '',
  teacherSubjectFilter: '',
  adminStudentQuery: ''
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
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

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

function logout() {
  saveSession(null);
  state.adminTab = 'dashboard';
  state.teacherTab = 'dashboard';
  state.studentTab = 'dashboard';
  renderWelcome();
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

function renderWelcome() {
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

  const form = document.getElementById('loginForm');
  form.addEventListener('submit', async (event) => {
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
        status.textContent = `This account is ${roleLabel(result.data.user.role)}. Please choose the correct login button.`;
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

  const backBtn = document.getElementById('backBtn');
  backBtn.addEventListener('click', renderWelcome);

  if (role === 'student') {
    document
      .getElementById('firstTimeSetPasswordBtn')
      .addEventListener('click', renderStudentFirstTimePassword);
  }
}

function renderStudentFirstTimePassword() {
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
          status.textContent = 'New password and confirm password do not match.';
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

        status.textContent = 'Password updated. Please login now.';
      } catch (error) {
        status.textContent = error.message;
      }
    });

  document
    .getElementById('backToStudentLoginBtn')
    .addEventListener('click', () => renderLogin('student'));
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

async function renderAdminDashboard() {
  const [meData, summaryResult, teachersResult, studentsResult] = await Promise.all([
    fetchMe(),
    api('/admin/summary'),
    api('/admin/teachers'),
    api('/admin/students')
  ]);

  const user = meData.user;
  const summary = summaryResult.data.summary;
  const teachers = teachersResult.data.teachers || [];
  const students = studentsResult.data.students || [];

  const query = state.adminStudentQuery.trim().toLowerCase();
  const filteredStudents = students.filter((student) =>
    student.fullName.toLowerCase().includes(query)
  );

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
              <section class="panel">
                <h3>How this works</h3>
                <p class="muted">Create teachers first. Teachers then create subjects and students. Students log in using Institution ID + username + password.</p>
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
                <label for="adminStudentSearch">Search by Name</label>
                <input id="adminStudentSearch" type="text" value="${escapeHtml(state.adminStudentQuery)}" placeholder="Type student name" />
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
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        filteredStudents.length
                          ? filteredStudents
                              .map(
                                (student) => `
                                  <tr>
                                    <td>${escapeHtml(student.fullName)}</td>
                                    <td>${escapeHtml(student.username)}</td>
                                    <td>${escapeHtml(student.email || '-')}</td>
                                    <td>${escapeHtml(student.phone || '-')}</td>
                                  </tr>
                                `
                              )
                              .join('')
                          : '<tr><td colspan="4">No matching students.</td></tr>'
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

  const adminStudentSearch = document.getElementById('adminStudentSearch');
  if (adminStudentSearch) {
    adminStudentSearch.addEventListener('input', (event) => {
      state.adminStudentQuery = event.target.value;
      void renderAdminDashboard();
    });
  }

  bindAccountPasswordForm();
}

async function renderTeacherDashboard() {
  const [meData, subjectsResult] = await Promise.all([fetchMe(), api('/teacher/subjects')]);
  const subjects = subjectsResult.data.subjects || [];

  const queryParams = new URLSearchParams();
  if (state.teacherStudentQuery.trim()) queryParams.set('q', state.teacherStudentQuery.trim());
  if (state.teacherSubjectFilter) queryParams.set('subjectId', state.teacherSubjectFilter);

  const studentsResult = await api(`/teacher/students${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
  const students = studentsResult.data.students || [];
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

        ${
          state.teacherTab === 'dashboard'
            ? `
              <section class="stats-grid">
                <article class="panel stat"><h3>${subjects.length}</h3><p>Subjects</p></article>
                <article class="panel stat"><h3>${students.length}</h3><p>Students</p></article>
                <article class="panel stat"><h3>${students.filter((s) => s.mustChangePassword).length}</h3><p>Students Pending Password Setup</p></article>
                <article class="panel stat"><h3>${students.filter((s) => s.email).length}</h3><p>Students with Email</p></article>
              </section>

              <section class="panel">
                <h3>Daily Workflow</h3>
                <p class="muted">1) Add subjects with syllabus. 2) Add students and assign subjects. 3) Share student credentials by WhatsApp/Email or CSV export.</p>
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
                    <input id="syllabusPdfName" type="text" placeholder="e.g. Physics-Sem1.pdf" />
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
                <pre class="credential-preview" id="studentCredentialPreview"></pre>
              </section>

              <section class="panel">
                <h3>Student Filters</h3>
                <div class="two-grid-form">
                  <div>
                    <label for="teacherStudentSearch">Search by Name</label>
                    <input id="teacherStudentSearch" type="text" value="${escapeHtml(
                      state.teacherStudentQuery
                    )}" placeholder="Type student name" />
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
                                const text = encodeURIComponent(
                                  `LIFT Educations login credentials\nInstitution ID: ${state.session.institutionId}\nUsername: ${student.username}`
                                );
                                return `
                                  <tr>
                                    <td>${escapeHtml(student.fullName)}</td>
                                    <td>${escapeHtml(student.username)}</td>
                                    <td>${
                                      student.email
                                        ? `<a href="mailto:${escapeHtml(student.email)}?subject=${encodeURIComponent(
                                            'Your LIFT Login Credentials'
                                          )}&body=${text}">Email</a>`
                                        : '-'
                                    }</td>
                                    <td>${escapeHtml(student.phone || '-')}</td>
                                    <td>
                                      ${
                                        whatsPhone
                                          ? `<a href="https://wa.me/${whatsPhone}?text=${text}" target="_blank" rel="noreferrer">WhatsApp</a>`
                                          : '-'
                                      }
                                    </td>
                                    <td><button class="mini-btn danger" data-delete-student="${student._id}">Delete</button></td>
                                  </tr>
                                `;
                              })
                              .join('')
                          : '<tr><td colspan="6">No students found.</td></tr>'
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
                <h3>Upload Resources</h3>
                <p class="muted">Resource upload UI is ready in frontend. Next backend step: persistent file storage (PDF, eBook, YouTube links).</p>
              </section>
            `
            : ''
        }

        ${
          state.teacherTab === 'tests'
            ? `
              <section class="panel">
                <h3>Conduct Test</h3>
                <p class="muted">Test creation UI is next backend phase: create MCQ/long tests, timer, attempt capture and score publishing.</p>
              </section>
            `
            : ''
        }

        ${
          state.teacherTab === 'messages'
            ? `
              <section class="panel">
                <h3>Messages</h3>
                <p class="muted">Social-style teacher-student chat UI is planned next. Backend models are already prepared.</p>
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
      const preview = document.getElementById('studentCredentialPreview');
      status.textContent = 'Creating student...';
      preview.textContent = '';

      try {
        const selected = Array.from(document.getElementById('studentSubjects').selectedOptions).map(
          (option) => option.value
        );

        if (!selected.length) {
          status.textContent = 'Choose at least one subject.';
          return;
        }

        const payload = {
          fullName: document.getElementById('studentFullName').value.trim(),
          username: document.getElementById('studentUsername').value.trim(),
          password: document.getElementById('studentTempPassword').value,
          email: document.getElementById('studentEmail').value.trim(),
          phone: document.getElementById('studentPhone').value.trim(),
          subjectIds: selected
        };

        const result = await api('/teacher/students', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        status.textContent = 'Student account created.';
        const student = result.data.student;
        preview.textContent = `Institution ID: ${state.session.institutionId}\nUsername: ${student.username}\nTemporary Password: ${payload.password}`;
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

  const exportBtn = document.getElementById('exportStudentsCsvBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      downloadCsv(
        'students.csv',
        ['fullName', 'username', 'email', 'phone'],
        students.map((student) => ({
          fullName: student.fullName,
          username: student.username,
          email: student.email || '',
          phone: student.phone || ''
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

  bindAccountPasswordForm();
}

async function renderStudentDashboard() {
  const [meData, dashboardResult, historyResult] = await Promise.all([
    fetchMe(),
    api('/student/dashboard'),
    api('/student/tests/history')
  ]);

  const user = meData.user;
  const dashboard = dashboardResult.data.dashboard;
  const history = historyResult.data.history || [];
  const pendingCount = Math.max(0, 20 - history.length);

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

        ${
          state.studentTab === 'dashboard'
            ? `
              <section class="alert-card">
                <div>
                  <h3>${pendingCount} tests are overdue</h3>
                  <p>Please complete pending tests to stay on track.</p>
                </div>
                <span class="alert-tag">Backlog</span>
              </section>

              <section class="two-grid">
                <article class="panel">
                  <h3>Today's Test</h3>
                  <p class="headline">MCQ Practice - Physics Fundamentals</p>
                  <p class="muted">20 questions | 5 minutes | auto-score</p>
                  <button class="cta-main">Start Test</button>
                </article>

                <article class="panel">
                  <h3>Today's Chapter</h3>
                  <p class="headline">Chapter 7 - Thermodynamics</p>
                  <p class="muted">Read guide and notes before attempting test.</p>
                  <button class="cta-soft">Open Guide</button>
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
                  <strong>${Math.min(100, Math.round((history.length / 20) * 100))}%</strong>
                </div>
                <div class="progress-track">
                  <div class="progress-fill" style="width: ${Math.min(100, Math.round((history.length / 20) * 100))}%"></div>
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
                <h3>Today's Test</h3>
                <p class="muted">Teacher published tests will appear here for 24 hours.</p>
              </section>
            `
            : ''
        }

        ${
          state.studentTab === 'pending'
            ? `
              <section class="panel">
                <h3>Pending Tests</h3>
                <p class="muted">Tests not completed within 24 hours appear here automatically.</p>
                <p class="headline">${pendingCount} pending</p>
              </section>
            `
            : ''
        }

        ${
          state.studentTab === 'messages'
            ? `
              <section class="panel">
                <h3>Message Teacher</h3>
                <p class="muted">Messaging module is prepared in backend models and will be connected in next sprint.</p>
              </section>
            `
            : ''
        }

        ${
          state.studentTab === 'resources'
            ? `
              <section class="panel">
                <h3>Resources</h3>
                <label for="resourceSearch">Search resources</label>
                <input id="resourceSearch" type="text" placeholder="e.g. Introduction to MS Word" />
                <p class="muted">Sections: PDFs, EBooks, Videos. Resource upload pipeline will be connected next.</p>
              </section>
            `
            : ''
        }

        ${
          state.studentTab === 'syllabus'
            ? `
              <section class="panel">
                <h3>Syllabus</h3>
                <p class="muted">Teacher-uploaded syllabus PDF will open in built-in viewer here.</p>
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
                                    <td>${
                                      item.scorePercent == null ? '-' : `${escapeHtml(item.scorePercent)}%`
                                    }</td>
                                  </tr>
                                `
                              )
                              .join('')
                          : '<tr><td colspan="4">No attempts yet.</td></tr>'
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
      renderWelcome();
    });
  }
}

if (state.session) {
  void renderByRole();
} else {
  renderWelcome();
}
