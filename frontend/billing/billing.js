// Only admin and receptionist can access the billing page
authGuard();
checkRole(['receptionist', 'admin']) || (location.href = '/dashboard/index.html');
checkSessionTimeout();

// Inject the shared header and sidebar
document.getElementById('header-slot').outerHTML = renderHeader();
document.getElementById('sidebar-slot').outerHTML = renderSidebar('billing');
applyRoleVisibility();

// Keep the full invoice list and supporting data in memory
let allInvoices = [];
let allServices = [];
let allPatients = [];
let paymentContextInvoice = null;

// If another page set this, we'll pre-select the patient when the create modal opens
let pendingPrefillPatientId = sessionStorage.getItem('prefillInvoicePatientId');
let pendingPrefillAppointmentId = sessionStorage.getItem('prefillInvoiceAppointmentId');

function clearPaymentError() {
  const errorEl = document.getElementById('payment-error');
  if (!errorEl) return;
  errorEl.style.display = 'none';
  errorEl.textContent = '';
}

function showPaymentError(message) {
  const errorEl = document.getElementById('payment-error');
  if (!errorEl) {
    showToast(message, 'error');
    return;
  }
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

function formatRemainingLabel(amount) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return 'Remaining: —';
  return `Remaining: ${formatCurrency(amount)}`;
}

function renderPaymentExtraFields(method) {
  const container = document.getElementById('payment-extra-fields');
  if (!container) return;

  if (method === 'Card') {
    container.innerHTML = `
      <div class="payment-extra-grid">
        <div class="form-group">
          <label class="form-label">Card Network</label>
          <input type="text" id="pay-card-network" class="form-control" placeholder="Visa, Mastercard...">
        </div>
        <div class="form-group">
          <label class="form-label">Card Last 4 Digits</label>
          <input type="text" id="pay-card-last4" class="form-control" maxlength="4" placeholder="1234">
        </div>
        <div class="form-group full-span">
          <label class="form-label">Authorization Code</label>
          <input type="text" id="pay-card-auth" class="form-control" placeholder="Bank authorization code">
        </div>
      </div>`;
    return;
  }

  if (method === 'Mobile') {
    container.innerHTML = `
      <div class="payment-extra-grid">
        <div class="form-group">
          <label class="form-label">Mobile Provider</label>
          <input type="text" id="pay-mobile-provider" class="form-control" placeholder="e.g. MTN, Zain">
        </div>
        <div class="form-group">
          <label class="form-label">Mobile Number</label>
          <input type="text" id="pay-mobile-number" class="form-control" placeholder="+211...">
        </div>
        <div class="form-group full-span">
          <label class="form-label">Transaction ID</label>
          <input type="text" id="pay-mobile-txn" class="form-control" placeholder="Required if no reference number">
        </div>
      </div>`;
    return;
  }

  if (method === 'Insurance') {
    container.innerHTML = `
      <div class="payment-extra-grid">
        <div class="form-group">
          <label class="form-label">Insurer Name</label>
          <input type="text" id="pay-insurer" class="form-control" placeholder="Insurance provider">
        </div>
        <div class="form-group">
          <label class="form-label">Claim Number</label>
          <input type="text" id="pay-claim-no" class="form-control" placeholder="Required if no reference number">
        </div>
        <div class="form-group full-span">
          <label class="form-label">Authorization Code</label>
          <input type="text" id="pay-ins-auth" class="form-control" placeholder="Optional pre-auth code">
        </div>
      </div>`;
    return;
  }

  container.innerHTML = '';
}

async function loadCompletedAppointmentsForPatient(patientId) {
  const appointmentSelect = document.getElementById('invoice-appointment-select');
  if (!appointmentSelect) return;

  if (!patientId) {
    appointmentSelect.innerHTML = '<option value="">Not linked to appointment</option>';
    return;
  }

  appointmentSelect.innerHTML = '<option value="">Loading completed appointments...</option>';

  try {
    const res = await apiFetch(`/api/appointments?patient_id=${patientId}&status=Completed`);
    const completed = (res?.appointments || []).filter(a => !a.has_invoice);

    if (!completed.length) {
      appointmentSelect.innerHTML = '<option value="">No completed appointment pending invoice</option>';
      return;
    }

    appointmentSelect.innerHTML =
      '<option value="">Not linked to appointment</option>' +
      completed.map(a => `
        <option value="${a.appointment_id}">
          ${formatDate(a.appointment_datetime)} ${formatTime(a.appointment_datetime)} - ${a.doctor_name || 'Doctor'}
        </option>
      `).join('');
  } catch (_e) {
    appointmentSelect.innerHTML = '<option value="">Failed to load appointments</option>';
  }
}

// Fetch all invoices from the backend
async function loadInvoices() {
  try {
    const res = await apiFetch('/api/invoices');
    allInvoices = res?.invoices || [];
    applyFilters();
  } catch (e) {
    document.getElementById('invoices-list').innerHTML =
      '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--danger);">Failed to load invoices</td></tr>';
  }
}

// Filter the invoice list by patient name/clinic number and payment status
function applyFilters() {
  const search = document.getElementById('filter-patient').value.trim().toLowerCase();
  const status = document.getElementById('filter-status').value;
  const filtered = allInvoices.filter(inv => {
    const name   = `${inv.first_name} ${inv.last_name}`.toLowerCase();
    const clinic = (inv.clinic_number || '').toLowerCase();
    if (search && !name.includes(search) && !clinic.includes(search)) return false;
    if (status && inv.payment_status !== status) return false;
    return true;
  });
  renderInvoices(filtered);
}

// Render the invoices table
function renderInvoices(invoices) {
  const tbody = document.getElementById('invoices-list');
  if (!invoices.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-text">No invoices found</div></div></td></tr>';
    return;
  }
  tbody.innerHTML = invoices.map(inv => `
    <tr>
      <td><strong>INV-${String(inv.invoice_id).padStart(4,'0')}</strong></td>
      <td>${inv.first_name} ${inv.last_name}<br><small style="color:var(--text-muted);">${inv.clinic_number}</small></td>
      <td>${formatDate(inv.invoice_date)}</td>
      <td>${formatCurrency(inv.total_amount)}</td>
      <td>${formatCurrency(inv.amount_due)}</td>
      <td>${renderBadge(inv.payment_status)}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-outline btn-sm" onclick="location.href='/billing/invoice.html?id=${inv.invoice_id}'">View</button>
          ${inv.payment_status !== 'Paid' ? `<button class="btn btn-primary btn-sm" onclick="openPaymentModal(${inv.invoice_id})">Pay</button>` : ''}
        </div>
      </td>
    </tr>`).join('');
}

// Open the create invoice modal and load patients + services if not already loaded
async function openCreateInvoice() {
  document.getElementById('services-tbody-new').innerHTML = '';
  document.getElementById('invoice-total-preview').textContent = '0 SSP';
  document.getElementById('invoice-patient-select').innerHTML = '<option value="">Loading patients...</option>';
  showModal('create-invoice-modal');

  try {
    // Load patients and services in parallel, reusing cached data if available
    const [pRes, sRes] = await Promise.all([
      allPatients.length ? Promise.resolve({ patients: allPatients }) : apiFetch('/api/patients'),
      allServices.length ? Promise.resolve({ services: allServices }) : apiFetch('/api/services')
    ]);
    allPatients = pRes?.patients || [];
    allServices = sRes?.services || [];

    const sel = document.getElementById('invoice-patient-select');
    sel.innerHTML = '<option value="">Select Patient</option>' +
      allPatients.map(p => `<option value="${p.patient_id}">${p.first_name} ${p.last_name} (${p.clinic_number})</option>`).join('');

    // If we were redirected here from another page with a patient pre-selected, apply it
    if (pendingPrefillPatientId) {
      sel.value = String(pendingPrefillPatientId);
      pendingPrefillPatientId = null;
      sessionStorage.removeItem('prefillInvoicePatientId');
    }

    await loadCompletedAppointmentsForPatient(sel.value);
    if (pendingPrefillAppointmentId) {
      const apptSel = document.getElementById('invoice-appointment-select');
      apptSel.value = String(pendingPrefillAppointmentId);
      pendingPrefillAppointmentId = null;
      sessionStorage.removeItem('prefillInvoiceAppointmentId');
    }
    addServiceRow();
  } catch (e) {
    showToast('Failed to load data for invoice', 'error');
  }
}

// Add a new service line item row to the create invoice form
function addServiceRow() {
  const tbody = document.getElementById('services-tbody-new');
  const tr = document.createElement('tr');
  const opts = allServices.map(s =>
    `<option value="${s.service_id}" data-price="${s.unit_price}">${s.service_name} — ${formatCurrency(s.unit_price)}</option>`
  ).join('');
  tr.innerHTML = `
    <td style="padding:6px 4px;">
      <select class="form-control svc-select" style="font-size:12px;" onchange="onServicePick(this)">
        <option value="">— Select service —</option>${opts}
      </select>
    </td>
    <td style="padding:6px 4px;text-align:right;">
      <input type="number" class="form-control qty-input" value="1" min="1" style="width:54px;font-size:12px;text-align:right;" oninput="updateInvoiceTotal()">
    </td>
    <td style="padding:6px 4px;text-align:right;">
      <input type="number" class="form-control price-input" value="0" min="0" step="0.01" style="width:90px;font-size:12px;text-align:right;" readonly>
    </td>
    <td style="padding:6px 4px;text-align:center;">
      <button type="button" onclick="this.closest('tr').remove();updateInvoiceTotal();"
        style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;">×</button>
    </td>`;
  tbody.appendChild(tr);
}

// Auto-fill the unit price when a service is selected from the dropdown
function onServicePick(select) {
  const opt = select.options[select.selectedIndex];
  const row = select.closest('tr');
  row.querySelector('.price-input').value = opt.value ? (parseFloat(opt.dataset.price) || 0).toFixed(2) : '0';
  updateInvoiceTotal();
}

// Recalculate the running total as the user adds or changes line items
function updateInvoiceTotal() {
  let total = 0;
  document.querySelectorAll('#services-tbody-new tr').forEach(tr => {
    const qty   = parseFloat(tr.querySelector('.qty-input')?.value)   || 0;
    const price = parseFloat(tr.querySelector('.price-input')?.value) || 0;
    total += qty * price;
  });
  document.getElementById('invoice-total-preview').textContent = formatCurrency(total);
}

// Submit the new invoice — backend expects patient_id and items with service_id + quantity
async function submitCreateInvoice() {
  const patientId = document.getElementById('invoice-patient-select').value;
  const appointmentId = document.getElementById('invoice-appointment-select').value;
  if (!patientId) { showToast('Please select a patient', 'error'); return; }

  const items = [];
  document.querySelectorAll('#services-tbody-new tr').forEach(tr => {
    const serviceId = tr.querySelector('.svc-select')?.value;
    const qty       = parseInt(tr.querySelector('.qty-input')?.value) || 1;
    if (serviceId) items.push({ service_id: parseInt(serviceId), quantity: qty });
  });

  if (!items.length) { showToast('Please select at least one service', 'error'); return; }

  try {
    await apiFetch('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({
        patient_id: parseInt(patientId),
        appointment_id: appointmentId ? parseInt(appointmentId) : null,
        items
      })
    });
    hideModal('create-invoice-modal');
    showToast('Invoice created successfully', 'success');
    loadInvoices();
  } catch (e) {
    showToast(e.message || 'Failed to create invoice', 'error');
  }
}

// Open the quick payment modal for a specific invoice
async function openPaymentModal(invoiceId) {
  clearPaymentError();
  document.getElementById('pay-invoice-id').value = invoiceId;
  document.getElementById('pay-amount').value = '';
  document.getElementById('pay-method').value = 'Cash';
  document.getElementById('pay-ref').value = '';
  renderPaymentExtraFields('Cash');

  paymentContextInvoice = null;
  const remainingEl = document.getElementById('pay-remaining');
  if (remainingEl) remainingEl.textContent = formatRemainingLabel(null);

  try {
    const res = await apiFetch(`/api/invoices/${invoiceId}`);
    const invoice = res?.invoice || null;
    paymentContextInvoice = invoice;
    if (remainingEl) {
      remainingEl.textContent = formatRemainingLabel(
        invoice?.remaining_balance ?? invoice?.amount_due
      );
    }
  } catch (_e) {}

  showModal('payment-modal');
}

function buildMethodPayload(method, referenceNo) {
  const payload = {};

  if (method === 'Card') {
    payload.card_network = document.getElementById('pay-card-network')?.value.trim() || '';
    payload.card_last4 = document.getElementById('pay-card-last4')?.value.trim() || '';
    payload.card_auth_code = document.getElementById('pay-card-auth')?.value.trim() || '';

    if (!referenceNo && !payload.card_last4 && !payload.card_auth_code) {
      throw new Error('Card payment needs card last 4 digits or authorization code (or reference number).');
    }
  }

  if (method === 'Mobile') {
    payload.mobile_provider = document.getElementById('pay-mobile-provider')?.value.trim() || '';
    payload.mobile_number = document.getElementById('pay-mobile-number')?.value.trim() || '';
    payload.mobile_txn_id = document.getElementById('pay-mobile-txn')?.value.trim() || '';

    if (!referenceNo && !payload.mobile_txn_id) {
      throw new Error('Mobile payment needs a transaction ID (or reference number).');
    }
  }

  if (method === 'Insurance') {
    payload.insurer_name = document.getElementById('pay-insurer')?.value.trim() || '';
    payload.insurance_claim_no = document.getElementById('pay-claim-no')?.value.trim() || '';
    payload.insurance_auth_code = document.getElementById('pay-ins-auth')?.value.trim() || '';

    if (!referenceNo && !payload.insurance_claim_no) {
      throw new Error('Insurance payment needs a claim number (or reference number).');
    }
  }

  return payload;
}

// Submit a payment against an invoice
async function submitPayment() {
  clearPaymentError();
  const invoiceId = document.getElementById('pay-invoice-id').value;
  const amount    = parseFloat(document.getElementById('pay-amount').value);
  const method    = document.getElementById('pay-method').value;
  const ref       = document.getElementById('pay-ref').value.trim();

  if (!amount || amount <= 0) { showPaymentError('Enter a valid amount.'); return; }

  const remaining = Number(paymentContextInvoice?.remaining_balance ?? paymentContextInvoice?.amount_due);
  if (!Number.isNaN(remaining) && amount > remaining) {
    showPaymentError(`Amount exceeds remaining balance (${formatCurrency(remaining)}).`);
    return;
  }

  let methodPayload = {};
  try {
    methodPayload = buildMethodPayload(method, ref);
  } catch (e) {
    showPaymentError(e.message || 'Fill in required payment details.');
    return;
  }

  try {
    await apiFetch('/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        invoice_id:     parseInt(invoiceId),
        amount_paid:    amount,
        payment_method: method,
        payment_date:   new Date().toISOString().split('T')[0],
        reference_no:   ref,
        received_by:    sessionStorage.getItem('name') || '',
        ...methodPayload
      })
    });
    hideModal('payment-modal');
    showToast('Payment recorded successfully', 'success');
    loadInvoices();
  } catch (e) {
    showPaymentError(e.message || 'Failed to record payment');
  }
}

// Re-apply filters whenever the user types in the search box or changes the status dropdown
document.getElementById('filter-patient').addEventListener('input', applyFilters);
document.getElementById('filter-status').addEventListener('change', applyFilters);
document.getElementById('invoice-patient-select').addEventListener('change', (e) => {
  loadCompletedAppointmentsForPatient(e.target.value);
});
document.getElementById('pay-method').addEventListener('change', (e) => {
  clearPaymentError();
  renderPaymentExtraFields(e.target.value);
});

loadInvoices();

// If we arrived here with a patient pre-fill, open the create modal straight away
if (pendingPrefillPatientId) openCreateInvoice();
