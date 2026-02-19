const API_CANDIDATE_PORTS = Array.from({ length: 21 }, (_, index) => 5050 + index);
const OWNER_HQ_ID = 'LIFT-HQ-0000';
const OWNER_SESSION_KEY = 'lift_owner_session_v1';
const OWNER_REMEMBER_KEY = 'lift_owner_remember_v1';

let apiBase = '';
let apiBaseResolved = false;
let ownerToken = '';
let institutionsCache = [];

function byId(id) {
  return document.getElementById(id);
}

function loadOwnerSession() {
  const parse = (storage) => {
    try {
      const raw = storage.getItem(OWNER_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.token) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  };

  return parse(localStorage) || parse(sessionStorage);
}

function saveOwnerSession(session, remember) {
  if (!session?.token) {
    localStorage.removeItem(OWNER_SESSION_KEY);
    sessionStorage.removeItem(OWNER_SESSION_KEY);
    return;
  }

  const serialized = JSON.stringify(session);
  const keep = Boolean(remember);
  localStorage.setItem(OWNER_REMEMBER_KEY, keep ? '1' : '0');

  if (keep) {
    localStorage.setItem(OWNER_SESSION_KEY, serialized);
    sessionStorage.removeItem(OWNER_SESSION_KEY);
    return;
  }

  sessionStorage.setItem(OWNER_SESSION_KEY, serialized);
  localStorage.removeItem(OWNER_SESSION_KEY);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function formatDateLabel(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString();
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0%';
  return `${Math.round(num * 10) / 10}%`;
}

function toPositiveInt(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

async function resolveApiBase() {
  if (apiBaseResolved) return apiBase;

  try {
    const sameOriginBase = `${window.location.origin}/api`;
    const response = await fetch(`${sameOriginBase}/health`, { method: 'GET' });
    if (response.ok || response.status === 401 || response.status === 403) {
      apiBase = sameOriginBase;
      apiBaseResolved = true;
      return apiBase;
    }
  } catch (error) {
    // fallback to local ports
  }

  for (const port of API_CANDIDATE_PORTS) {
    const probe = `http://127.0.0.1:${port}/api/health`;
    try {
      const response = await fetch(probe, { method: 'GET' });
      if (!response.ok) continue;
      apiBase = `http://127.0.0.1:${port}/api`;
      apiBaseResolved = true;
      return apiBase;
    } catch (error) {
      continue;
    }
  }

  apiBase = `${window.location.origin}/api`;
  apiBaseResolved = true;
  return apiBase;
}

async function api(path, options = {}) {
  const base = await resolveApiBase();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (ownerToken) headers.Authorization = `Bearer ${ownerToken}`;

  const response = await fetch(`${base}${path}`, { ...options, headers });
  let data = null;
  const contentType = String(response.headers.get('content-type') || '');
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch (error) {
      throw new Error('Invalid server response.');
    }
  } else {
    const text = await response.text();
    if (/Authentication Required|Vercel Authentication/i.test(text)) {
      throw new Error(
        'This preview deployment is protected by Vercel login. Use the production URL or disable preview protection.'
      );
    }
    throw new Error('Invalid server response.');
  }
  if (!response.ok) {
    throw new Error(data.message || 'Request failed');
  }
  return data;
}

function showDashboard() {
  byId('ownerLoginCard').classList.add('hidden');
  byId('ownerDashboard').classList.remove('hidden');
}

function showLogin() {
  byId('ownerDashboard').classList.add('hidden');
  byId('ownerLoginCard').classList.remove('hidden');
}

function renderSummary(summary) {
  const root = byId('ownerSummaryGrid');
  const items = [
    { label: 'Total Institutions', value: summary.totalInstitutions },
    { label: 'Active Institutions', value: summary.activeInstitutions },
    { label: 'Paid Plans', value: summary.paidInstitutions },
    { label: 'Pending Payments', value: summary.pendingInstitutions },
    { label: 'Cancelled', value: summary.cancelledInstitutions },
    { label: 'Total Teachers', value: summary.totalTeachers },
    { label: 'Total Students', value: summary.totalStudents },
    { label: 'Subjects Created', value: summary.totalSubjects }
  ];

  root.innerHTML = items
    .map(
      (item) => `
      <article class="owner-summary-tile">
        <div class="owner-summary-label">${escapeHtml(item.label)}</div>
        <div class="owner-summary-value">${escapeHtml(item.value)}</div>
      </article>
    `
    )
    .join('');
}

function roleAnalyticsTile(roleLabel, metrics) {
  if (!metrics) {
    return `
      <article class="owner-summary-tile">
        <div class="owner-summary-label">${escapeHtml(roleLabel)}</div>
        <div class="owner-summary-value">0</div>
        <div class="owner-mini-list"><p>No data yet.</p></div>
      </article>
    `;
  }

  return `
    <article class="owner-summary-tile">
      <div class="owner-summary-label">${escapeHtml(roleLabel)}</div>
      <div class="owner-summary-value">${escapeHtml(metrics.activated)} / ${escapeHtml(metrics.onboarded)}</div>
      <div class="owner-mini-list">
        <p><strong>Activation:</strong> ${escapeHtml(formatPercent(metrics.activationRate))}</p>
        <p><strong>Drop-off:</strong> ${escapeHtml(formatPercent(metrics.dropOffRate))}</p>
        <p><strong>Active 7d:</strong> ${escapeHtml(metrics.retention?.active7d || 0)}</p>
      </div>
    </article>
  `;
}

function renderAnalytics(analytics) {
  const roleRoot = byId('ownerRoleFunnelGrid');
  const funnelRoot = byId('ownerInstitutionFunnel');
  const eventsRoot = byId('ownerTopEvents');

  if (!roleRoot || !funnelRoot || !eventsRoot) return;

  const roles = analytics?.roleFunnels || {};
  roleRoot.innerHTML = [
    roleAnalyticsTile('Admin Funnel', roles.admin),
    roleAnalyticsTile('Teacher Funnel', roles.teacher),
    roleAnalyticsTile('Student Funnel', roles.student)
  ].join('');

  const institutionFunnel = analytics?.institutionFunnel || {};
  funnelRoot.innerHTML = `
    <div class="owner-mini-list">
      <p><strong>Total Institutions:</strong> ${escapeHtml(institutionFunnel.totalInstitutions || 0)}</p>
      <p><strong>With Teachers:</strong> ${escapeHtml(institutionFunnel.institutionsWithTeachers || 0)}</p>
      <p><strong>With Subjects:</strong> ${escapeHtml(institutionFunnel.institutionsWithSubjects || 0)}</p>
      <p><strong>With Students:</strong> ${escapeHtml(institutionFunnel.institutionsWithStudents || 0)}</p>
      <p><strong>With Tests:</strong> ${escapeHtml(institutionFunnel.institutionsWithTests || 0)}</p>
    </div>
  `;

  const events = analytics?.eventsByType || [];
  if (!events.length) {
    eventsRoot.innerHTML = '<p class=\"muted\">No event data yet.</p>';
    return;
  }

  eventsRoot.innerHTML = `
    <div class=\"owner-mini-list\">
      ${events
        .slice(0, 8)
        .map(
          (item) =>
            `<p><strong>${escapeHtml(item.eventType)}:</strong> ${escapeHtml(item.count)}</p>`
        )
        .join('')}
    </div>
  `;
}

function getFilteredInstitutions() {
  const query = byId('ownerInstitutionSearch').value.trim().toLowerCase();
  if (!query) return institutionsCache;
  return institutionsCache.filter((item) => {
    const name = String(item.name || '').toLowerCase();
    const id = String(item.institutionId || '').toLowerCase();
    return name.includes(query) || id.includes(query);
  });
}

function renderInstitutionTable() {
  const rows = getFilteredInstitutions();
  const root = byId('ownerInstitutionTableBody');

  if (!rows.length) {
    root.innerHTML = `
      <tr>
        <td colspan="14">No institutions found.</td>
      </tr>
    `;
    return;
  }

  root.innerHTML = rows
    .map((item) => {
      const isHq = item.institutionId === OWNER_HQ_ID;
      return `
      <tr data-inst-id="${escapeHtml(item.institutionId)}">
        <td>
          <strong>${escapeHtml(item.name)}</strong><br />
          <code>${escapeHtml(item.institutionId)}</code>
        </td>
        <td>
          <select data-field="planType">
            <option value="trial" ${item.planType === 'trial' ? 'selected' : ''}>Trial</option>
            <option value="paid" ${item.planType === 'paid' ? 'selected' : ''}>Paid</option>
          </select>
        </td>
        <td>
          <select data-field="paymentStatus">
            <option value="pending" ${item.paymentStatus === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="paid" ${item.paymentStatus === 'paid' ? 'selected' : ''}>Paid</option>
            <option value="cancelled" ${item.paymentStatus === 'cancelled' ? 'selected' : ''}>Cancelled</option>
          </select>
        </td>
        <td>
          <select data-field="isActive" ${isHq ? 'disabled' : ''}>
            <option value="true" ${item.isActive ? 'selected' : ''}>Yes</option>
            <option value="false" ${!item.isActive ? 'selected' : ''}>No</option>
          </select>
          <div class="status-pill ${item.isActive ? 'active' : 'inactive'}">
            ${item.isActive ? 'Active' : 'Inactive'}
          </div>
        </td>
        <td><input data-field="trialTeacherLimit" type="number" min="1" value="${escapeHtml(item.trialTeacherLimit)}" /></td>
        <td><input data-field="trialSubjectLimitPerTeacher" type="number" min="1" value="${escapeHtml(item.trialSubjectLimitPerTeacher)}" /></td>
        <td><input data-field="studentLimit" type="number" min="1" value="${escapeHtml(item.studentLimit)}" /></td>
        <td>${escapeHtml(item.teacherCount || 0)}</td>
        <td>${escapeHtml(item.studentCount || 0)}</td>
        <td>${escapeHtml(item.subjectCount || 0)}</td>
        <td><code>${escapeHtml(item.adminCredentials?.username || 'admin')}</code></td>
        <td><code>${escapeHtml(item.adminCredentials?.temporaryPassword || '-')}</code></td>
        <td>
          <input data-field="subscriptionEndsAt" type="date" value="${escapeHtml(formatDateInput(item.subscriptionEndsAt))}" />
          <small>${escapeHtml(formatDateLabel(item.subscriptionEndsAt))}</small>
        </td>
        <td>
          <div class="owner-row-actions">
            <button class="cta-soft owner-save-btn" data-action="save">Save</button>
            <button class="cta-soft" data-action="reset-admin-password" ${isHq ? 'disabled' : ''}>Reset Admin Password</button>
            <button class="cta-soft owner-cancel-btn" data-action="cancel" ${isHq ? 'disabled' : ''}>Cancel Subscription</button>
          </div>
        </td>
      </tr>
    `;
    })
    .join('');
}

async function loadDashboardData() {
  const analyticsDays = byId('ownerAnalyticsWindow')?.value || '30';
  const [summaryResult, institutionsResult, analyticsResult] = await Promise.all([
    api('/super-admin/summary'),
    api('/super-admin/institutions'),
    api(`/super-admin/analytics?days=${encodeURIComponent(analyticsDays)}&limit=150`)
  ]);

  renderSummary(summaryResult.data || {});
  renderAnalytics(analyticsResult.data?.analytics || {});
  institutionsCache = institutionsResult.data?.institutions || [];
  renderInstitutionTable();
}

function setTableStatus(message) {
  byId('ownerTableStatus').textContent = message;
}

byId('ownerLoginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = byId('ownerLoginStatus');
  status.textContent = 'Signing in...';

  try {
    const payload = {
      institutionId: byId('ownerInstitutionId').value.trim(),
      username: byId('ownerUsername').value.trim(),
      password: byId('ownerPassword').value
    };

    const result = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (result.data.user.role !== 'super_admin') {
      status.textContent = 'This account is not allowed for owner panel.';
      return;
    }

    ownerToken = result.data.token;
    const remember = byId('ownerRememberMe')?.checked ?? true;
    saveOwnerSession(
      {
        token: ownerToken,
        institutionId: payload.institutionId,
        username: payload.username
      },
      remember
    );
    status.textContent = 'Login successful.';
    showDashboard();
    await loadDashboardData();
  } catch (error) {
    status.textContent = error.message;
  }
});

byId('ownerPasswordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = byId('ownerPasswordStatus');
  const currentPassword = byId('ownerCurrentPassword').value;
  const newPassword = byId('ownerNewPassword').value;
  const confirmPassword = byId('ownerConfirmPassword').value;

  if (newPassword !== confirmPassword) {
    status.textContent = 'New password and confirmation do not match.';
    return;
  }

  status.textContent = 'Updating password...';
  try {
    await api('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword,
        newPassword
      })
    });
    status.textContent = 'Owner password updated successfully.';
    byId('ownerPasswordForm').reset();
  } catch (error) {
    status.textContent = error.message;
  }
});

byId('createInstitutionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = byId('ownerCreateStatus');
  const box = byId('ownerCredentialBox');
  status.textContent = 'Creating institution...';
  box.textContent = '';

  try {
    const institutionName = byId('institutionName').value.trim();
    const cityCode = byId('cityCode').value.trim();
    const adminName = byId('adminName').value.trim() || 'Institution Admin';
    const adminEmail = byId('adminEmail').value.trim();

    if (institutionName.length < 2) {
      status.textContent = 'Institution name must be at least 2 characters.';
      return;
    }

    if (cityCode && !/^[A-Za-z0-9]{1,6}$/.test(cityCode)) {
      status.textContent = 'City code should contain only letters/numbers (max 6).';
      return;
    }

    const payload = {
      institutionName,
      cityCode,
      planType: byId('planType').value,
      trialTeacherLimit: toPositiveInt(byId('trialTeacherLimit').value, 5),
      trialSubjectLimitPerTeacher: toPositiveInt(byId('trialSubjectLimitPerTeacher').value, 5),
      studentLimit: toPositiveInt(byId('studentLimit').value, 200),
      adminName,
      adminEmail
    };

    const result = await api('/super-admin/institutions', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const institution = result.data.institution;
    const credentials = result.data.adminCredentials;
    status.textContent = 'Institution created successfully.';
    box.textContent = [
      `Institution: ${institution.name}`,
      `Institution ID: ${institution.institutionId}`,
      `Admin Username: ${credentials.username}`,
      `Temporary Password: ${credentials.temporaryPassword}`
    ].join('\n');

    await loadDashboardData();
  } catch (error) {
    status.textContent =
      error.message || 'Unable to create institution. Please verify inputs and try again.';
  }
});

byId('ownerInstitutionSearch').addEventListener('input', () => {
  renderInstitutionTable();
});

byId('ownerInstitutionTableBody').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const row = event.target.closest('tr[data-inst-id]');
  if (!row) return;

  const institutionId = row.getAttribute('data-inst-id');
  const action = button.getAttribute('data-action');

  if (action === 'save') {
    setTableStatus(`Updating ${institutionId}...`);
    try {
      const payload = {
        planType: row.querySelector('[data-field="planType"]').value,
        paymentStatus: row.querySelector('[data-field="paymentStatus"]').value,
        isActive: row.querySelector('[data-field="isActive"]').value === 'true',
        trialTeacherLimit: Number(row.querySelector('[data-field="trialTeacherLimit"]').value || 0),
        trialSubjectLimitPerTeacher: Number(
          row.querySelector('[data-field="trialSubjectLimitPerTeacher"]').value || 0
        ),
        studentLimit: Number(row.querySelector('[data-field="studentLimit"]').value || 0),
        subscriptionEndsAt: row.querySelector('[data-field="subscriptionEndsAt"]').value || ''
      };

      await api(`/super-admin/institutions/${encodeURIComponent(institutionId)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });

      setTableStatus(`Saved changes for ${institutionId}.`);
      await loadDashboardData();
    } catch (error) {
      setTableStatus(error.message);
    }
  }

  if (action === 'cancel') {
    const confirmCancel = window.confirm(
      `Cancel subscription for ${institutionId}? This will disable institution access.`
    );
    if (!confirmCancel) return;

    setTableStatus(`Cancelling subscription for ${institutionId}...`);
    try {
      await api(`/super-admin/institutions/${encodeURIComponent(institutionId)}/cancel-subscription`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      setTableStatus(`Subscription cancelled for ${institutionId}.`);
      await loadDashboardData();
    } catch (error) {
      setTableStatus(error.message);
    }
  }

  if (action === 'reset-admin-password') {
    const confirmed = window.confirm(
      `Reset admin password for ${institutionId}? A new temporary password will be generated.`
    );
    if (!confirmed) return;

    setTableStatus(`Resetting admin password for ${institutionId}...`);
    try {
      const result = await api(
        `/super-admin/institutions/${encodeURIComponent(institutionId)}/reset-admin-password`,
        {
          method: 'POST',
          body: JSON.stringify({})
        }
      );
      const creds = result.data?.adminCredentials;
      setTableStatus(
        creds?.temporaryPassword
          ? `New password for ${institutionId}: ${creds.temporaryPassword}`
          : `Admin password reset for ${institutionId}.`
      );
      await loadDashboardData();
    } catch (error) {
      setTableStatus(error.message);
    }
  }
});

byId('refreshDashboardBtn').addEventListener('click', async () => {
  setTableStatus('Refreshing dashboard...');
  try {
    await loadDashboardData();
    setTableStatus('Dashboard refreshed.');
  } catch (error) {
    setTableStatus(error.message);
  }
});

byId('refreshAnalyticsBtn').addEventListener('click', async () => {
  setTableStatus('Refreshing analytics...');
  try {
    await loadDashboardData();
    setTableStatus('Analytics refreshed.');
  } catch (error) {
    setTableStatus(error.message);
  }
});

byId('ownerAnalyticsWindow').addEventListener('change', async () => {
  try {
    await loadDashboardData();
    setTableStatus('Analytics window updated.');
  } catch (error) {
    setTableStatus(error.message);
  }
});

const purgeButton = byId('purgeCancelledBtn');
if (purgeButton) {
  purgeButton.addEventListener('click', async () => {
    const purgeStatus = byId('ownerPurgeStatus');
    const confirmed = window.confirm(
      'Delete all cancelled subscriptions permanently? This will remove all related users and records.'
    );
    if (!confirmed) return;

    purgeStatus.textContent = 'Deleting cancelled subscriptions...';
    try {
      const result = await api('/super-admin/institutions/purge-cancelled', {
        method: 'DELETE',
        body: JSON.stringify({})
      });
      const purgedCount = Number(result.data?.purgedCount || 0);
      purgeStatus.textContent =
        purgedCount > 0
          ? `Deleted ${purgedCount} cancelled subscription(s).`
          : 'No cancelled subscriptions found.';
      setTableStatus(purgeStatus.textContent);
      await loadDashboardData();
    } catch (error) {
      purgeStatus.textContent = error.message;
      setTableStatus(error.message);
    }
  });
}

byId('ownerSignOutBtn').addEventListener('click', () => {
  ownerToken = '';
  saveOwnerSession(null, false);
  institutionsCache = [];
  byId('ownerLoginStatus').textContent = '';
  byId('ownerTableStatus').textContent = '';
  byId('ownerPasswordStatus').textContent = '';
  byId('ownerCreateStatus').textContent = '';
  if (byId('ownerPurgeStatus')) byId('ownerPurgeStatus').textContent = '';
  byId('ownerCredentialBox').textContent = '';
  byId('ownerLoginForm').reset();
  byId('ownerPasswordForm').reset();
  byId('createInstitutionForm').reset();
  showLogin();
});

const remembered = localStorage.getItem(OWNER_REMEMBER_KEY);
byId('ownerRememberMe').checked = remembered !== '0';

const existingSession = loadOwnerSession();
if (existingSession?.institutionId) byId('ownerInstitutionId').value = existingSession.institutionId;
if (existingSession?.username) byId('ownerUsername').value = existingSession.username;
if (!byId('ownerInstitutionId').value) byId('ownerInstitutionId').value = OWNER_HQ_ID;

if (existingSession?.token) {
  ownerToken = existingSession.token;
  showDashboard();
  loadDashboardData().catch((error) => {
    ownerToken = '';
    saveOwnerSession(null, false);
    showLogin();
    byId('ownerLoginStatus').textContent = error.message || 'Session expired. Please sign in again.';
  });
}
