authGuard();
document.getElementById('header-slot').outerHTML = renderHeader();
document.getElementById('sidebar-slot').outerHTML = renderSidebar('patients');
applyRoleVisibility();

const params    = new URLSearchParams(window.location.search);
const patientId = params.get('id');
if (!patientId) window.location.href = 'list.html';

let patientData       = null;
let visitsData        = [];
let prescriptionsData = [];
let appointmentsData  = [];
let billingData       = [];

function infoRow(label, value) {
  return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
    <span style="color:var(--text-muted);">${label}</span>
    <span style="font-weight:500;">${value ?? '—'}</span>
  </div>`;
}

function renderSummaryCard(value, label, note = '') {
  return `<div class="stat-card">
    <div class="stat-card-value">${value}</div>
    <div class="stat-card-label">${label}</div>
    ${note ? `<div style="margin-top:6px;font-size:11px;color:var(--text-muted);">${note}</div>` : ''}
  </div>`;
}

function renderPatientSummary() {
  const summary = document.getElementById('patient-summary');
  if (!summary) return;
  const totalDiagnoses = visitsData.reduce((c, v) => c + ((v.diagnoses ?? []).length), 0);
  const activePrescriptions = prescriptionsData.filter(i => getPrescriptionStatus(i.end_time) === 'Active').length;
  const openInvoices = billingData.filter(i => i.payment_status === 'Unpaid' || i.payment_status === 'Partial').length;
  const latestVisit = visitsData[0]?.visit_date ? formatDate(visitsData[0].visit_date) : 'No visits yet';
  summary.innerHTML = [
    renderSummaryCard(visitsData.length, 'Visits', latestVisit),
    renderSummaryCard(totalDiagnoses, 'Diagnoses', totalDiagnoses ? 'Across recorded medical visits' : 'No diagnoses yet'),
    renderSummaryCard(activePrescriptions, 'Active Prescriptions', prescriptionsData.length ? `${prescriptionsData.length} total prescriptions` : 'No prescriptions yet'),
    renderSummaryCard(openInvoices, 'Open Invoices', appointmentsData.length ? `${appointmentsData.length} appointments on record` : 'No appointments yet')
  ].join('');
}

function renderDiagnosisChips(diagnoses) {
  if (!diagnoses?.length) return '<span style="color:var(--text-muted);">—</span>';
  return diagnoses.map(item => `<span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:#E0F2FE;color:#0F172A;font-size:11px;margin:0 6px 6px 0;">${item}</span>`).join('');
}

async function loadPatient() {
  try {
    const data = await apiFetch(`/api/patients/${patientId}`);
    patientData = data.patient;
    const p = patientData;
    document.getElementById('page-title').textContent = `${p.first_name} ${p.last_name}`;
    document.title = `${p.first_name} ${p.last_name} — CCMS`;
    document.getElementById('personal-info').innerHTML =
      infoRow('Clinic Number', `<span style="color:var(--primary);font-weight:700;">${p.clinic_number}</span>`) +
      infoRow('Full Name', `${p.first_name} ${p.last_name}`) +
      infoRow('Date of Birth', `${formatDate(p.date_of_birth)} (Age ${calculateAge(p.date_of_birth)})`) +
      infoRow('Gender', p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : 'Other') +
      infoRow('Phone', p.phone) + infoRow('Email', p.email) +
      infoRow('Address', p.address) + infoRow('Registered', formatDate(p.registered_at));
    document.getElementById('medical-info').innerHTML =
      infoRow('Blood Type', p.blood_type) + infoRow('Insurance', p.insurance_provider) +
      infoRow('Emergency Contact', p.emergency_contact) + infoRow('National ID', p.national_id);
  } catch (e) {
    document.getElementById('personal-info').innerHTML = '<div class="empty-state"><div class="empty-state-text">Could not load patient</div></div>';
  }
}

async function loadVisits() {
  try {
    const data = await apiFetch(`/api/medical-visits/${patientId}`);
    visitsData = data?.visits ?? [];
    const tbody = document.getElementById('visits-tbody');
    if (!visitsData.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-text">No visits recorded</div></div></td></tr>';
      renderPatientSummary(); return;
    }
    const role = sessionStorage.getItem('role');
    tbody.innerHTML = visitsData.map(v => `
      <tr>
        <td>${formatDate(v.visit_date)}</td>
        <td>${v.doctor_name ?? '—'}</td>
        <td style="font-size:12px;line-height:1.6;">${renderDiagnosisChips(v.diagnoses ?? [])}</td>
        <td style="font-size:12px;color:var(--text-muted);max-width:280px;line-height:1.5;">${v.notes ?? '—'}</td>
        <td>${(role === 'admin' || role === 'receptionist') ? `<button class="btn btn-outline btn-sm" onclick="openInvoiceModal(${v.visit_id})">Create Invoice</button>` : ''}</td>
      </tr>`).join('');
    renderPatientSummary();
  } catch (e) {
    visitsData = []; renderPatientSummary();
    document.getElementById('visits-tbody').innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-state-text">Could not load visits</div></div></td></tr>';
  }
}

async function loadPrescriptions() {
  try {
    const data = await apiFetch(`/api/patients/${patientId}/prescriptions`);
    prescriptionsData = data?.prescriptions ?? [];
    const tbody = document.getElementById('prescriptions-tbody');
    if (!prescriptionsData.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-text">No prescriptions found</div></div></td></tr>';
      renderPatientSummary(); return;
    }
    tbody.innerHTML = prescriptionsData.map(pr => `
      <tr>
        <td style="font-weight:500;">${pr.drug_name}</td>
        <td>${pr.dosage ?? '—'}</td><td>${pr.duration ?? '—'}</td>
        <td>${formatDate(pr.visit_date)}</td>
        <td>${renderBadge(getPrescriptionStatus(pr.end_time))}</td>
      </tr>`).join('');
    renderPatientSummary();
  } catch (e) {
    prescriptionsData = []; renderPatientSummary();
    document.getElementById('prescriptions-tbody').innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-text">Could not load prescriptions</div></div></td></tr>';
  }
}

async function loadAppointments() {
  try {
    const data = await apiFetch(`/api/appointments?patient_id=${patientId}`);
    appointmentsData = data?.appointments ?? [];
    const tbody = document.getElementById('appts-tbody');
    if (!appointmentsData.length) {
      tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-state-text">No appointments found</div></div></td></tr>';
      renderPatientSummary(); return;
    }
    tbody.innerHTML = appointmentsData.map(a => `
      <tr>
        <td>${formatDate(a.appointment_datetime)} <span style="color:var(--text-muted);font-size:12px;">${formatTime(a.appointment_datetime)}</span></td>
        <td>${a.doctor_name ?? '—'}</td>
        <td style="font-size:12px;">${a.reason ?? '—'}</td>
        <td>${renderBadge(a.status)}</td>
      </tr>`).join('');
    renderPatientSummary();
  } catch (e) {
    appointmentsData = []; renderPatientSummary();
    document.getElementById('appts-tbody').innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-state-text">Could not load appointments</div></div></td></tr>';
  }
}

async function loadBilling() {
  try {
    const data = await apiFetch(`/api/invoices?patient_id=${patientId}`);
    billingData = data?.invoices ?? [];
    const tbody = document.getElementById('billing-tbody');
    if (!billingData.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-state-text">No invoices found</div></div></td></tr>';
      renderPatientSummary(); return;
    }
    tbody.innerHTML = billingData.map(inv => `
      <tr>
        <td style="font-weight:600;color:var(--primary);">#${inv.invoice_id}</td>
        <td>${formatDate(inv.invoice_date)}</td>
        <td>${formatCurrency(inv.total_amount)}</td>
        <td>${formatCurrency(inv.amount_due)}</td>
        <td>${renderBadge(inv.payment_status)}</td>
        <td><a href="/billing/invoice.html?id=${inv.invoice_id}" class="btn btn-outline btn-sm">View</a></td>
      </tr>`).join('');
    renderPatientSummary();
  } catch (e) {
    billingData = []; renderPatientSummary();
    document.getElementById('billing-tbody').innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-state-text">Could not load billing</div></div></td></tr>';
  }
}

function switchTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
}

function openEditModal() {
  if (!patientData) return;
  const p = patientData;
  document.getElementById('edit-phone').value      = p.phone ?? '';
  document.getElementById('edit-email').value      = p.email ?? '';
  document.getElementById('edit-blood-type').value = p.blood_type ?? '';
  document.getElementById('edit-insurance').value  = p.insurance_provider ?? '';
  document.getElementById('edit-address').value    = p.address ?? '';
  document.getElementById('edit-emergency').value  = p.emergency_contact ?? '';
  document.getElementById('edit-modal').classList.add('open');
}

function closeEditModal() { document.getElementById('edit-modal').classList.remove('open'); }

async function savePatient() {
  const updates = {
    phone:              document.getElementById('edit-phone').value.trim(),
    email:              document.getElementById('edit-email').value.trim(),
    blood_type:         document.getElementById('edit-blood-type').value,
    insurance_provider: document.getElementById('edit-insurance').value.trim(),
    address:            document.getElementById('edit-address').value.trim(),
    emergency_contact:  document.getElementById('edit-emergency').value.trim()
  };
  try {
    await apiFetch(`/api/patients/${patientId}`, { method: 'PATCH', body: JSON.stringify(updates) });
    showToast('Patient updated successfully', 'success');
    closeEditModal();
    loadPatient();
  } catch (e) {
    showToast(e.message || 'Failed to update patient', 'error');
  }
}

loadPatient(); loadVisits(); loadPrescriptions(); loadAppointments(); loadBilling();

// Invoice modal
let invoiceVisitId   = null;
let invoicePatientId = null;
let allServices      = [];

async function openInvoiceModal(visitId) {
  invoiceVisitId = visitId; invoicePatientId = patientId;
  document.getElementById('inv-doctor').textContent     = '—';
  document.getElementById('inv-visit-date').textContent = '—';
  document.getElementById('inv-notes').textContent      = '—';
  document.getElementById('inv-diagnoses').textContent  = '—';
  document.getElementById('inv-items-tbody').innerHTML  = '';
  document.getElementById('inv-discount').value         = '0';
  document.getElementById('inv-total').textContent      = 'SSP 0.00';
  document.getElementById('invoice-modal').classList.add('open');
  try {
    const [visitRes, svcRes] = await Promise.all([
      apiFetch(`/api/visits/${visitId}/summary`),
      allServices.length ? Promise.resolve({ services: allServices }) : apiFetch('/api/services')
    ]);
    const v = visitRes.visit;
    allServices = svcRes.services ?? [];
    document.getElementById('inv-doctor').textContent     = v.doctor_name ?? '—';
    document.getElementById('inv-visit-date').textContent = formatDate(v.visit_date);
    document.getElementById('inv-notes').textContent      = v.notes || '—';
    document.getElementById('inv-diagnoses').textContent  = v.diagnoses?.length ? v.diagnoses.join('; ') : '—';
    (v.prescriptions ?? []).forEach(rx => {
      addInvoiceItemRow(`${rx.drug_name}${rx.dosage ? ' — ' + rx.dosage : ''}${rx.duration ? ' (' + rx.duration + ')' : ''}`, 1, '');
    });
    addInvoiceServiceRow();
  } catch (e) { showToast('Could not load visit details', 'error'); }
}

function closeInvoiceModal() {
  document.getElementById('invoice-modal').classList.remove('open');
  invoiceVisitId = null;
}

function addInvoiceItemRow(name, qty, price) {
  const tbody = document.getElementById('inv-items-tbody');
  const tr    = document.createElement('tr');
  const opts  = allServices.map(s => `<option value="${s.service_id}" data-price="${s.unit_price}">${s.service_name} (SSP ${parseFloat(s.unit_price).toFixed(2)})</option>`).join('');
  tr.innerHTML = `
    <td style="padding:6px 4px;">
      <input type="text" class="form-control inv-item-name" value="${name ?? ''}" placeholder="Item / drug name" style="font-size:12px;">
      <select class="form-control inv-service-pick" style="font-size:11px;margin-top:4px;color:var(--text-muted);" onchange="pickService(this)">
        <option value="">— or pick from catalogue —</option>${opts}
      </select>
    </td>
    <td style="padding:6px 4px;text-align:right;">
      <input type="number" class="form-control inv-item-qty" value="${qty ?? 1}" min="1" style="width:54px;font-size:12px;text-align:right;" oninput="updateInvTotal()">
    </td>
    <td style="padding:6px 4px;text-align:right;">
      <input type="number" class="form-control inv-item-price" value="${price ?? ''}" min="0" step="0.01" placeholder="0.00" style="width:90px;font-size:12px;text-align:right;" oninput="updateInvTotal()">
    </td>
    <td style="padding:6px 4px;text-align:center;">
      <button type="button" onclick="this.closest('tr').remove();updateInvTotal();" style="background:none;border:none;color:var(--danger);font-size:15px;cursor:pointer;line-height:1;">×</button>
    </td>`;
  tbody.appendChild(tr);
  updateInvTotal();
}

function addInvoiceServiceRow() { addInvoiceItemRow('', 1, ''); }

function pickService(select) {
  const opt = select.options[select.selectedIndex];
  if (!opt.value) return;
  const row = select.closest('tr');
  const price = parseFloat(opt.dataset.price) || 0;
  row.querySelector('.inv-item-name').value  = opt.text.split(' (SSP')[0];
  row.querySelector('.inv-item-price').value = price.toFixed(2);
  select.value = '';
  updateInvTotal();
}

function updateInvTotal() {
  let subtotal = 0;
  document.querySelectorAll('#inv-items-tbody tr').forEach(tr => {
    const qty   = parseFloat(tr.querySelector('.inv-item-qty')?.value)   || 0;
    const price = parseFloat(tr.querySelector('.inv-item-price')?.value) || 0;
    subtotal += qty * price;
  });
  const discount = parseFloat(document.getElementById('inv-discount').value) || 0;
  document.getElementById('inv-total').textContent = `SSP ${Math.max(0, subtotal - discount).toFixed(2)}`;
}

async function submitInvoice() {
  const rows = [...document.querySelectorAll('#inv-items-tbody tr')];
  const items = [];
  for (const tr of rows) {
    const name  = tr.querySelector('.inv-item-name')?.value.trim()  || '';
    const qty   = parseInt(tr.querySelector('.inv-item-qty')?.value)   || 1;
    const price = parseFloat(tr.querySelector('.inv-item-price')?.value) || 0;
    if (!name || price <= 0) continue;
    items.push({ service_name: name, quantity: qty, unit_price: price });
  }
  if (!items.length) { showToast('Add at least one item with a price', 'error'); return; }
  const discount = parseFloat(document.getElementById('inv-discount').value) || 0;
  try {
    const res = await apiFetch('/api/invoices/from-visit', {
      method: 'POST',
      body: JSON.stringify({ patient_id: parseInt(invoicePatientId), visit_id: invoiceVisitId, discount, items })
    });
    closeInvoiceModal();
    showToast('Invoice created successfully', 'success');
    window.location.href = `/billing/invoice.html?id=${res.invoice_id}`;
  } catch (e) { showToast(e.message || 'Failed to create invoice', 'error'); }
}

if (params.get('edit') === 'true') openEditModal();
