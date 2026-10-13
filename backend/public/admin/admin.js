const state = {
  page: 1,
  pageSize: 20,
  totalPages: 1,
  selectedId: null,
  search: '',
  status: 'ALL',
  refreshTimer: null,
};

const $ = (id) => document.getElementById(id);

const statusLabels = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  REVIEWING: 'Reviewing',
  ON_HOLD: 'On hold',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
};

const fieldLabels = {
  bankName: 'Name of bank', branchName: 'Branch name', branchCode: 'Branch code', country: 'Country',
  branchDistrict: 'Branch district', branchThana: 'Branch thana / upazila', incorporationNumber: 'Incorporation number',
  incorporationDate: 'Incorporation date', registrationAuthority: 'Registration authority', registeredAddress: 'Registered address',
  tradeLicenseNumber: 'Trade license number', tradeLicenseDate: 'Trade license date', tradeLicenseExpiry: 'Trade license expiry',
  tradeLicenseAuthority: 'Trade license authority', tinNumber: 'TIN number', officeDistrict: 'Office district', officeThana: 'Office thana / upazila',
  officeAddress: 'Office address', officeEmail: 'Office email', officeMobile: 'Office mobile', accountTitleBangla: 'Account title (Bangla)',
  accountTitleEnglish: 'Account title (English)', accountNature: 'Nature of account', businessSector: 'Business sector', subCategory: 'Sub category',
  currency: 'Currency', entityType: 'Entity type', accountType: 'Account type', personFullName: 'Operating person', fatherName: 'Father name',
  motherName: 'Mother name', nidNumber: 'NID number', dateOfBirth: 'Date of birth', nationality: 'Nationality', gender: 'Gender',
  relationWithOrganization: 'Relation with organization', occupation: 'Occupation', monthlyIncome: 'Monthly income', sourceOfFund: 'Source of fund',
  presentDistrict: 'Present district', presentThana: 'Present thana / upazila', presentAddress: 'Present address', presentEmail: 'Present email', presentMobile: 'Present mobile',
  permanentDistrict: 'Permanent district', permanentThana: 'Permanent thana / upazila', permanentAddress: 'Permanent address', permanentEmail: 'Permanent email', permanentMobile: 'Permanent mobile',
};

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function humanStatus(status) { return statusLabels[status] || status || '—'; }

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}

function showToast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function showLogin() {
  $('loginView').classList.remove('hidden');
  $('appView').classList.add('hidden');
}

function showApp(username) {
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('adminUser').textContent = username;
}

async function init() {
  try {
    const me = await api('/api/admin/me');
    showApp(me.username);
    await refreshAll();
    state.refreshTimer = setInterval(() => refreshAll(false), 15000);
  } catch {
    showLogin();
  }
}

async function login(event) {
  event.preventDefault();
  $('loginError').classList.add('hidden');
  try {
    const result = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('username').value, password: $('password').value }),
    });
    $('password').value = '';
    showApp(result.username);
    await refreshAll();
  } catch (error) {
    $('loginError').textContent = error.message;
    $('loginError').classList.remove('hidden');
  }
}

async function logout() {
  try { await api('/api/admin/logout', { method: 'POST' }); } finally { showLogin(); }
}

async function refreshAll(showErrors = true) {
  try {
    await Promise.all([loadStats(), loadApplications()]);
    if (state.selectedId) await loadDetail(state.selectedId, false);
  } catch (error) {
    if (error.message.includes('authentication')) showLogin();
    else if (showErrors) showToast(error.message);
  }
}

async function loadStats() {
  const data = await api('/api/admin/stats');
  const cards = [
    ['Total', data.total], ['Submitted', data.submitted], ['Reviewing', data.reviewing], ['On hold', data.on_hold],
    ['Accepted', data.accepted], ['Rejected', data.rejected], ['Draft', data.draft],
  ];
  $('stats').innerHTML = cards.map(([label, value]) => `<div class="stat-card"><span class="stat-label">${esc(label)}</span><span class="stat-value">${Number(value || 0)}</span></div>`).join('');
}

async function loadApplications() {
  const params = new URLSearchParams({ page: state.page, pageSize: state.pageSize, status: state.status, search: state.search });
  const data = await api(`/api/admin/applications?${params}`);
  state.totalPages = data.pages || 1;
  $('pageInfo').textContent = `Page ${data.page} of ${state.totalPages} · ${data.total} records`;
  $('prevPage').disabled = state.page <= 1;
  $('nextPage').disabled = state.page >= state.totalPages;

  if (!data.applications.length) {
    $('applicationList').innerHTML = '<p class="muted">No applications found.</p>';
    return;
  }

  $('applicationList').innerHTML = data.applications.map((app) => `
    <button class="app-item ${state.selectedId === app.id ? 'active' : ''}" data-id="${esc(app.id)}">
      <div class="app-top"><span class="app-number">${esc(app.application_number)}</span><span class="status ${esc(app.status)}">${esc(humanStatus(app.status))}</span></div>
      <div class="app-title">${esc(app.account_title || 'Account title not available')}</div>
      <div class="app-meta"><span>${esc(app.bank_name || '—')}</span><span>${esc(app.office_email || '—')}</span></div>
      <div class="app-meta"><span>Created ${esc(formatDate(app.created_at))}</span></div>
    </button>
  `).join('');

  document.querySelectorAll('.app-item').forEach((button) => button.addEventListener('click', () => {
    state.selectedId = button.dataset.id;
    loadApplications().then(() => loadDetail(state.selectedId));
  }));
}

function renderPayload(payload) {
  const entries = Object.entries(payload || {})
    .filter(([key]) => !key.startsWith('documentName_') && !key.startsWith('documentBytes_'))
    .filter(([, value]) => value !== null && value !== undefined && value !== '');
  return `<div class="kv-grid">${entries.map(([key, value]) => `
    <div class="kv"><div class="kv-label">${esc(fieldLabels[key] || key)}</div><div class="kv-value">${esc(typeof value === 'object' ? JSON.stringify(value) : value)}</div></div>
  `).join('')}</div>`;
}

function renderDocuments(detail) {
  if (!detail.documents?.length) return '<p class="muted">No documents uploaded.</p>';
  return `<div class="docs">${detail.documents.map((doc) => `
    <div class="doc-row">
      <div><div class="doc-name">${esc(doc.document_type)}</div><div class="doc-meta">${esc(doc.original_name)} · ${Math.round((Number(doc.size_bytes || 0) / 1024))} KB</div></div>
      <a class="ghost" style="text-decoration:none; padding:8px 10px; border-radius:10px; font-weight:800;" target="_blank" href="/api/admin/applications/${encodeURIComponent(detail.id)}/documents/${encodeURIComponent(doc.id)}">Open</a>
    </div>
  `).join('')}</div>`;
}

function renderAudit(detail) {
  if (!detail.audit?.length) return '<p class="muted">No activity recorded.</p>';
  return `<div class="audit">${detail.audit.map((item) => `
    <div class="audit-item">
      <div class="audit-top"><span>${esc(item.action.replaceAll('_', ' '))}</span><span class="muted small">${esc(formatDate(item.created_at))}</span></div>
      <div class="muted small">${esc(item.actor_username || item.actor_type || 'system')} · ${esc(item.from_status || '—')} → ${esc(item.to_status || '—')}</div>
      ${item.note ? `<div style="margin-top:4px;">${esc(item.note)}</div>` : ''}
    </div>
  `).join('')}</div>`;
}

async function loadDetail(id, showErrors = true) {
  if (!id) return;
  try {
    const detail = await api(`/api/admin/applications/${encodeURIComponent(id)}`);
    const canReview = detail.status !== 'DRAFT';
    $('detailPanel').classList.remove('empty-state');
    $('detailPanel').innerHTML = `
      <div class="detail-head">
        <div><p class="eyebrow">${esc(detail.application_number)}</p><h2>${esc(detail.payload?.accountTitleEnglish || 'Investor account application')}</h2><div class="muted">Created ${esc(formatDate(detail.created_at))} · Submitted ${esc(formatDate(detail.submitted_at))}</div></div>
        <div class="detail-actions"><span class="status ${esc(detail.status)}">${esc(humanStatus(detail.status))}</span></div>
      </div>
      ${detail.reviewed_by ? `<div class="section"><div class="muted small">Last decision by <strong>${esc(detail.reviewed_by)}</strong> at ${esc(formatDate(detail.reviewed_at))}</div>${detail.review_note ? `<div style="margin-top:5px;"><strong>Decision note:</strong> ${esc(detail.review_note)}</div>` : ''}</div>` : ''}
      ${canReview ? `
        <div class="section">
          <h3>Review decision</h3>
          <div class="review-box">
            <select id="decisionStatus">
              <option value="REVIEWING" ${detail.status === 'REVIEWING' ? 'selected' : ''}>Reviewing</option>
              <option value="ON_HOLD" ${detail.status === 'ON_HOLD' ? 'selected' : ''}>On hold</option>
              <option value="ACCEPTED">Accept</option>
              <option value="REJECTED">Reject</option>
            </select>
            <div>
              <textarea id="decisionNote" placeholder="Add a review/decision note. A note is required for Accept or Reject."></textarea>
              <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;"><button id="saveDecision" class="primary">Save review status</button></div>
            </div>
          </div>
        </div>` : ''}
      <div class="section"><h3>Submitted application data</h3>${renderPayload(detail.payload)}</div>
      <div class="section"><h3>Documents</h3>${renderDocuments(detail)}</div>
      <div class="section"><h3>Audit / monitoring history</h3>${renderAudit(detail)}</div>
    `;

    if (canReview) {
      $('saveDecision').addEventListener('click', async () => {
        const status = $('decisionStatus').value;
        const note = $('decisionNote').value.trim();
        if ((status === 'ACCEPTED' || status === 'REJECTED') && !note) {
          showToast('Add a decision note before accepting or rejecting.');
          return;
        }
        $('saveDecision').disabled = true;
        try {
          await api(`/api/admin/applications/${encodeURIComponent(id)}/status`, {
            method: 'POST', body: JSON.stringify({ status, note }),
          });
          showToast(`Application moved to ${humanStatus(status)}.`);
          await refreshAll(false);
        } catch (error) {
          showToast(error.message);
        } finally {
          if ($('saveDecision')) $('saveDecision').disabled = false;
        }
      });
    }
  } catch (error) {
    if (showErrors) showToast(error.message);
  }
}

$('loginForm').addEventListener('submit', login);
$('logoutBtn').addEventListener('click', logout);
$('refreshBtn').addEventListener('click', () => refreshAll());
$('prevPage').addEventListener('click', () => { if (state.page > 1) { state.page -= 1; refreshAll(); } });
$('nextPage').addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; refreshAll(); } });
$('statusFilter').addEventListener('change', () => { state.status = $('statusFilter').value; state.page = 1; refreshAll(); });
let searchTimer;
$('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.search = $('searchInput').value.trim(); state.page = 1; refreshAll(); }, 300);
});

init();
