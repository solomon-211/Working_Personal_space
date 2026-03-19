// Make sure the user is logged in before viewing a patient profile
authGuard();
checkSessionTimeout();

// Inject the shared header and sidebar
document.getElementById('header-slot').outerHTML = renderHeader();
document.getElementById('sidebar-slot').outerHTML = renderSidebar('patients');
applyRoleVisibility();

// Get the patient ID from the URL — redirect away if it's missing
const params    = new URLSearchParams(window.location.search);
const patientId = params.get('id');
if (!patientId) location.href = '/patients/list.html';

// These hold the data loaded from each tab so we can reuse it without re-fetching
let patientData       = null;
let visitsData        = [];
let prescriptionsData = [];
let appointmentsData  = [];
let billingData       = [];
let allServices       = [];
const currentRole = sessionStorage.getItem('role') || '';

// Build a single label/value row for the info panels
function infoRow(label, value) {
  return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
    <span style="color:var(--text-muted);">${label}</span>
    <span style="font-weight:500;">${value ?? '—'}</span>
  </div>`;
}

// Render a diagnosis as a small pill/chip
function diagChip(text) {
  return `<span style="display:inline-flex;padding:3px 8px;border-radius:999px;background:#E0F2FE;color:#0F172A;font-size:11px;margin:0 4px 4px 0;">${text}</span>`;
}

function renderAppointmentInvoiceCell(appt) {
  const hasInvoice = Number(appt.has_invoice) === 1 || !!appt.linked_invoice_id;

  if (hasInvoice) {
    return `
      <span class="badge badge-paid" style="margin-right:8px;">Created</span>
      <a href="/billing/invoice.html?id=${appt.linked_invoice_id}" class="btn btn-outline btn-sm">View</a>
    `;
  }

  if (appt.status === 'Completed') {
    if (currentRole === 'admin' || currentRole === 'receptionist') {
      return `<button class="btn btn-primary btn-sm" onclick="createInvoiceFromAppointment(${appt.appointment_id})">Create Invoice</button>`;
    }
    return '<span class="badge badge-partial">Pending Invoice</span>';
  }

  return '<span class="badge badge-unpaid">Not Ready</span>';
}

function createInvoiceFromAppointment(appointmentId) {
  sessionStorage.setItem('prefillInvoicePatientId', String(patientId));
  sessionStorage.setItem('prefillInvoiceAppointmentId', String(appointmentId));
  location.href = '/billing/index.html';
}

// Update the summary stat cards at the top of the profile page
function renderPatientSummary() {
  const el = document.getElementById('patient-summary');
  if (!el) return;
  const totalDiag = visitsData.reduce((c, v) => c + (v.diagnoses?.length || 0), 0);
  const activeRx  = prescriptionsData.filter(p => getPrescriptionStatus(p.end_time) === 'Active').length;
  const openInv   = billingData.filter(i => i.payment_status === 'Unpaid' || i.payment_status === 'Partial').length;
  const lastVisit = visitsData[0]?.visit_date ? formatDate(visitsData[0].visit_date) : 'No visits yet';
  el.innerHTML = [
    `<div class="stat-card"><div class="stat-card-value">${visitsData.length}</div><div class="stat-card-label">Visits</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${lastVisit}</div></div>`,
    `<div class="stat-card"><div class="stat-card-value">${totalDiag}</div><div class="stat-card-label">Diagnoses</div></div>`,
    `<div class="stat-card"><div class="stat-card-value">${activeRx}</div><div class="stat-card-label">Active Prescriptions</div></div>`,
    `<div class="stat-card"><div class="stat-card-value">${openInv}</div><div class="stat-card-label">Open Invoices</div></div>`
  ].join('');
}

// Load the patient's personal and medical info
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
      infoRow('Blood Type', p.blood_type) +
      infoRow('Insurance', p.insurance_provider) +
      infoRow('Emergency Contact', p.emergency_contact) +
      infoRow('National ID', p.national_id);
  } catch (e) {
    document.getElementById('personal-info').innerHTML =
      '<div class="empty-state"><div class="empty-state-text">Could not load patient</div></div>';
  }
}

function renderVisitInvoiceCell(visit, role) {
  if (Number(visit.has_invoice) === 1) {
    return `<a href="/billing/invoice.html?id=${visit.linked_invoice_id}" class="btn btn-outline btn-sm">View Invoice</a>`;
  }
  if (role === 'admin' || role === 'receptionist') {
    return `<button class="btn btn-primary btn-sm" onclick="openInvoiceModal(${visit.visit_id}, ${JSON.stringify(visit).replace(/"/g,'&quot;')})">Generate Invoice</button>`;
  }
  return '<span class="badge badge-partial">Pending Invoice</span>';
}

// Load the patient's medical visit history with diagnoses attached
async function loadVisits() {
  try {
    const data = await apiFetch(`/api/medical-visits/${patientId}`);
    visitsData = data?.visits ?? [];
    const tbody = document.getElementById('visits-tbody');
    const role  = sessionStorage.getItem('role');
    if (!visitsData.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-text">No visits recorded</div></div></td></tr>';
    } else {
      tbody.innerHTML = visitsData.map(v => `
        <tr>
          <td>${formatDate(v.visit_date)}</td>
          <td>${v.doctor_name ?? '—'}</td>
          <td style="font-size:12px;">${(v.diagnoses ?? []).map(diagChip).join('') || '—'}</td>
          <td style="font-size:12px;color:var(--text-muted);max-width:260px;">${v.notes ?? '—'}</td>
          <td>${renderVisitInvoiceCell(v, role)}</td>
        </tr>`).join('');
    }
  } catch (e) {
    visitsData = [];
    document.getElementById('visits-tbody').innerHTML =
      '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-text">Could not load visits</div></div></td></tr>';
  }
  renderPatientSummary();
}

// Load prescriptions using GET /api/prescriptions/:patient_id
async function loadPrescriptions() {
  try {
    const data = await apiFetch(`/api/prescriptions/${patientId}`);
    prescriptionsData = data?.prescriptions ?? [];
    const tbody = document.getElementById('prescriptions-tbody');
    if (!prescriptionsData.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-text">No prescriptions found</div></div></td></tr>';
    } else {
      tbody.innerHTML = prescriptionsData.map(pr => `
        <tr>
          <td style="font-weight:500;">${pr.drug_name}</td>
          <td>${pr.dosage ?? '—'}</td>
          <td>${pr.duration ?? '—'}</td>
          <td>${formatDate(pr.visit_date)}</td>
          <td>${renderBadge(getPrescriptionStatus(pr.end_time))}</td>
        </tr>`).join('');
    }
  } catch (e) {
    prescriptionsData = [];
    document.getElementById('prescriptions-tbody').innerHTML =
      '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-text">Could not load prescriptions</div></div></td></tr>';
  }
  renderPatientSummary();
}

// Load all appointments for this patient
async function loadAppointments() {
  try {
    const data = await apiFetch(`/api/appointments?patient_id=${patientId}`);
    appointmentsData = data?.appointments ?? [];
    const tbody = document.getElementById('appts-tbody');
    if (!appointmentsData.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-text">No appointments found</div></div></td></tr>';
    } else {
      tbody.innerHTML = appointmentsData.map(a => `
        <tr>
          <td>${formatDate(a.appointment_datetime)} <span style="color:var(--text-muted);font-size:12px;">${formatTime(a.appointment_datetime)}</span></td>
          <td>${a.doctor_name ?? '—'}</td>
          <td style="font-size:12px;">${a.reason ?? '—'}</td>
          <td>${renderBadge(a.status)}</td>
          <td>${renderAppointmentInvoiceCell(a)}</td>
        </tr>`).join('');
    }
  } catch (e) {
    appointmentsData = [];
    document.getElementById('appts-tbody').innerHTML =
      '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-text">Could not load appointments</div></div></td></tr>';
  }
  renderPatientSummary();
}

// Load all invoices for this patient
async function loadBilling() {
  try {
    const data = await apiFetch(`/api/invoices?patient_id=${patientId}`);
    billingData = data?.invoices ?? [];
    const tbody = document.getElementById('billing-tbody');
    if (!billingData.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-state-text">No invoices found</div></div></td></tr>';
    } else {
      tbody.innerHTML = billingData.map(inv => `
        <tr>
          <td style="font-weight:600;color:var(--primary);">#${inv.invoice_id}</td>
          <td>${formatDate(inv.invoice_date)}</td>
          <td>${formatCurrency(inv.total_amount)}</td>
          <td>${formatCurrency(inv.amount_due)}</td>
          <td>${renderBadge(inv.payment_status)}</td>
          <td><a href="/billing/invoice.html?id=${inv.invoice_id}" class="btn btn-outline btn-sm">View</a></td>
        </tr>`).join('');
    }
  } catch (e) {
    billingData = [];
    document.getElementById('billing-tbody').innerHTML =
      '<tr><td colspan="6"><div class="empty-state"><div class="empty-state-text">Could not load billing</div></div></td></tr>';
  }
  renderPatientSummary();
}

// Switch between the profile tabs (visits, prescriptions, appointments, billing)
function switchTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
}

// Open the edit modal and pre-fill it with the current patient data
function openEditModal() {
  if (!patientData) return;
  const p = patientData;
  document.getElementById('edit-phone').value      = p.phone ?? '';
  document.getElementById('edit-email').value      = p.email ?? '';
  document.getElementById('edit-blood-type').value = p.blood_type ?? '';
  document.getElementById('edit-insurance').value  = p.insurance_provider ?? '';
  document.getElementById('edit-address').value    = p.address ?? '';
  document.getElementById('edit-emergency').value  = p.emergency_contact ?? '';
  showModal('edit-modal');
}

function closeEditModal() { hideModal('edit-modal'); }

// Save the updated patient fields — only the allowed fields are sent to the backend
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

// Track which visit the invoice modal was opened for
let invoiceVisitId   = null;
let invoiceVisitData = null;

// Open the create invoice modal for a specific visit
async function openInvoiceModal(visitId, visitObj) {
  invoiceVisitId   = visitId;
  invoiceVisitData = visitObj;
  document.getElementById('inv-items-tbody').innerHTML = '';
  document.getElementById('inv-discount').value = '0';
  document.getElementById('inv-total').textContent = 'SSP 0.00';
  document.getElementById('inv-doctor').textContent     = visitObj?.doctor_name ?? '—';
  document.getElementById('inv-visit-date').textContent = formatDate(visitObj?.visit_date);
  document.getElementById('inv-diagnoses').textContent  = visitObj?.diagnoses?.length ? visitObj.diagnoses.join('; ') : '—';
  showModal('invoice-modal');

  // Load the services catalogue if we haven't already
  if (!allServices.length) {
    try {
      const res = await apiFetch('/api/services');
      allServices = res?.services ?? [];
    } catch (e) { showToast('Could not load services catalogue', 'error'); }
  }
  addInvoiceRow();
}

function closeInvoiceModal() {
  hideModal('invoice-modal');
  invoiceVisitId   = null;
  invoiceVisitData = null;
}

// Add a new service line item row to the invoice form
function addInvoiceRow() {
  const tbody = document.getElementById('inv-items-tbody');
  const tr    = document.createElement('tr');
  const opts  = allServices.map(s =>
    `<option value="${s.service_id}" data-price="${s.unit_price}">${s.service_name} (${formatCurrency(s.unit_price)})</option>`
  ).join('');
  tr.innerHTML = `
    <td style="padding:6px 4px;">
      <select class="form-control inv-svc" style="font-size:12px;" onchange="pickInvService(this)">
        <option value="">— Select service —</option>${opts}
      </select>
    </td>
    <td style="padding:6px 4px;text-align:right;">
      <input type="number" class="form-control inv-qty" value="1" min="1"
        style="width:54px;font-size:12px;text-align:right;" oninput="updateInvTotal()">
    </td>
    <td style="padding:6px 4px;text-align:right;">
      <input type="number" class="form-control inv-price" value="0" min="0" step="0.01"
        style="width:90px;font-size:12px;text-align:right;" readonly>
    </td>
    <td style="padding:6px 4px;text-align:center;">
      <button type="button" onclick="this.closest('tr').remove();updateInvTotal();"
        style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;">×</button>
    </td>`;
  tbody.appendChild(tr);
}

// When a service is selected, auto-fill the unit price from the catalogue
function pickInvService(select) {
  const opt = select.options[select.selectedIndex];
  const row = select.closest('tr');
  row.querySelector('.inv-price').value = opt.value ? (parseFloat(opt.dataset.price) || 0).toFixed(2) : '0';
  updateInvTotal();
}

// Recalculate the invoice total whenever a quantity or service changes
function updateInvTotal() {
  let subtotal = 0;
  document.querySelectorAll('#inv-items-tbody tr').forEach(tr => {
    subtotal += (parseFloat(tr.querySelector('.inv-qty')?.value) || 0) *
                (parseFloat(tr.querySelector('.inv-price')?.value) || 0);
  });
  const discount = parseFloat(document.getElementById('inv-discount').value) || 0;
  document.getElementById('inv-total').textContent = `SSP ${Math.max(0, subtotal - discount).toFixed(2)}`;
}

// Submit the invoice to the backend — visit_id is required to link and deduplicate
async function submitInvoice() {
  const items = [];
  document.querySelectorAll('#inv-items-tbody tr').forEach(tr => {
    const serviceId = tr.querySelector('.inv-svc')?.value;
    const qty       = parseInt(tr.querySelector('.inv-qty')?.value) || 1;
    if (serviceId) items.push({ service_id: parseInt(serviceId), quantity: qty });
  });

  if (!items.length) { showToast('Select at least one service', 'error'); return; }

  const discount = parseFloat(document.getElementById('inv-discount').value) || 0;

  try {
    const res = await apiFetch('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({
        patient_id: parseInt(patientId),
        visit_id:   invoiceVisitId,
        items,
        discount
      })
    });
    closeInvoiceModal();
    showToast('Invoice created successfully.', 'success');
    await loadVisits();
    await loadBilling();
  } catch (e) {
    showToast(e.message || 'Failed to create invoice', 'error');
  }
}

// Load all sections when the page opens
loadPatient();
loadVisits();
loadPrescriptions();
loadAppointments();
loadBilling();

// If the URL has ?edit=true, open the edit modal automatically
if (params.get('edit') === 'true') setTimeout(openEditModal, 500);

// If arriving from the appointments page via Generate Invoice, open the visits tab
if (window.location.hash === '#billing') {
  setTimeout(() => {
    const btn = document.querySelector('.tab-btn[onclick*="visits"]');
    if (btn) { btn.click(); }
  }, 600);
}