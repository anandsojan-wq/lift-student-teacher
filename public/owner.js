const API_CANDIDATE_PORTS = Array.from({ length: 21 }, (_, index) => 5050 + index);
let apiBase = 'http://127.0.0.1:5050/api';
let apiBaseResolved = false;
let ownerToken = '';

function byId(id) {
  return document.getElementById(id);
}

async function resolveApiBase() {
  if (apiBaseResolved) return apiBase;

  try {
    const sameOriginBase = `${window.location.origin}/api`;
    const response = await fetch(`${sameOriginBase}/health`, { method: 'GET' });
    if (response.ok) {
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

  apiBaseResolved = true;
  return apiBase;
}

async function api(path, options = {}) {
  const base = await resolveApiBase();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (ownerToken) headers.Authorization = `Bearer ${ownerToken}`;

  const response = await fetch(`${base}${path}`, { ...options, headers });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Request failed');
  }
  return data;
}

function showPrivatePanel() {
  byId('ownerPanel').classList.remove('hidden');
  byId('ownerInstitutionListCard').classList.remove('hidden');
}

function renderInstitutions(items) {
  const root = byId('ownerInstitutionList');
  if (!items.length) {
    root.innerHTML = '<p class="muted">No institutions yet.</p>';
    return;
  }

  root.innerHTML = items
    .map(
      (item) => `
      <article class="owner-item">
        <strong>${item.name}</strong>
        <p>ID: ${item.institutionId}</p>
        <p>Plan: ${item.planType.toUpperCase()} | Payment: ${item.paymentStatus.toUpperCase()}</p>
        <p>Teacher Limit: ${item.trialTeacherLimit} | Subject Limit: ${item.trialSubjectLimitPerTeacher}</p>
      </article>
    `
    )
    .join('');
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
    status.textContent = 'Login successful.';
    showPrivatePanel();

    const institutions = await api('/super-admin/institutions');
    renderInstitutions(institutions.data.institutions || []);
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
    const payload = {
      institutionName: byId('institutionName').value.trim(),
      cityCode: byId('cityCode').value.trim(),
      planType: byId('planType').value,
      trialTeacherLimit: Number(byId('trialTeacherLimit').value || 5),
      trialSubjectLimitPerTeacher: Number(byId('trialSubjectLimitPerTeacher').value || 5),
      studentLimit: Number(byId('studentLimit').value || 200),
      adminName: byId('adminName').value.trim(),
      adminEmail: byId('adminEmail').value.trim()
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

    const institutions = await api('/super-admin/institutions');
    renderInstitutions(institutions.data.institutions || []);
  } catch (error) {
    status.textContent = error.message;
  }
});

byId('refreshInstitutionsBtn').addEventListener('click', async () => {
  const status = byId('ownerCreateStatus');
  if (!ownerToken) {
    status.textContent = 'Please login first.';
    return;
  }

  try {
    const institutions = await api('/super-admin/institutions');
    renderInstitutions(institutions.data.institutions || []);
    status.textContent = 'Institution list refreshed.';
  } catch (error) {
    status.textContent = error.message;
  }
});
