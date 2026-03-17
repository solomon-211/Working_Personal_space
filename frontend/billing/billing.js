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

// If another page set this, we'll pre-select the patient when the create modal opens
let pendingPrefillPatientId = sessionStorage.getItem('prefillInvoicePatientId');

// Fetch all invoices from the backend
async function loadInvoices() {
  try {
    const response = await apiFetch('/api/invoices');
    allInvoices = response?.invoices || [];
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
  const filtered = allInvoices.filter(invoice => {
    const name   = `${invoice.first_name} ${invoice.last_name}`.toLowerCase();
    const clinic = (invoice.clinic_number || '').toLowerCase();
    if (search && !name.includes(search) && !clinic.includes(search)) return false;
    if (status && invoice.payment_status !== status) return false;
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
  tbody.innerHTML = invoices.map(invoice => `
    <tr>
      <td><strong>INV-${String(invoice.invoice_id).padStart(4,'0')}</strong></td>
      <td>${invoice.first_name} ${invoice.last_name}<br><small style="color:var(--text-muted);">${invoice.clinic_number}</small></td>
      <td>${formatDate(invoice.invoice_date)}</td>
      <td>${formatCurrency(invoice.total_amount)}</td>
      <td>${formatCurrency(invoice.amount_due)}</td>
      <td>${renderBadge(invoice.payment_status)}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-outline btn-sm" onclick="location.href='/billing/invoice.html?id=${invoice.invoice_id}'">View</button>
          ${invoice.payment_status !== 'Paid' ? `<button class="btn btn-primary btn-sm" onclick="openPaymentModal(${invoice.invoice_id})">Pay</button>` : ''}
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
    const [patientsResponse, servicesResponse] = await Promise.all([
      allPatients.length ? Promise.resolve({ patients: allPatients }) : apiFetch('/api/patients'),
      allServices.length ? Promise.resolve({ services: allServices }) : apiFetch('/api/services')
    ]);
    allPatients = patientsResponse?.patients || [];
    allServices = servicesResponse?.services || [];

    const patientSelect = document.getElementById('invoice-patient-select');
    patientSelect.innerHTML = '<option value="">Select Patient</option>' +
      allPatients.map(patient => `<option value="${patient.patient_id}">${patient.first_name} ${patient.last_name} (${patient.clinic_number})</option>`).join('');

    // If we were redirected here from another page with a patient pre-selected, apply it
    if (pendingPrefillPatientId) {
      patientSelect.value = String(pendingPrefillPatientId);
      pendingPrefillPatientId = null;
      sessionStorage.removeItem('prefillInvoicePatientId');
    }
    addServiceRow();
  } catch (e) {
    showToast('Failed to load data for invoice', 'error');
  }
}

// Add a new service line item row to the create invoice form
function addServiceRow() {
  const tbody = document.getElementById('services-tbody-new');
  const row = document.createElement('tr');
  const serviceOptions = allServices.map(service =>
    `<option value="${service.service_id}" data-price="${service.unit_price}">${service.service_name} — ${formatCurrency(service.unit_price)}</option>`
  ).join('');
  row.innerHTML = `
    <td style="padding:6px 4px;">
      <select class="form-control service-select" style="font-size:12px;" onchange="onServicePick(this)">
        <option value="">— Select service —</option>${serviceOptions}
      </select>
    </td>
    <td style="padding:6px 4px;text-align:right;">
      <input type="number" class="form-control quantity-input" value="1" min="1" style="width:54px;font-size:12px;text-align:right;" oninput="updateInvoiceTotal()">
    </td>
    <td style="padding:6px 4px;text-align:right;">
      <input type="number" class="form-control price-input" value="0" min="0" step="0.01" style="width:90px;font-size:12px;text-align:right;" readonly>
    </td>
    <td style="padding:6px 4px;text-align:center;">
      <button type="button" onclick="this.closest('tr').remove();updateInvoiceTotal();"
        style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;">×</button>
    </td>`;
  tbody.appendChild(row);
}

// Auto-fill the unit price when a service is selected from the dropdown
function onServicePick(select) {
  const selectedOption = select.options[select.selectedIndex];
  const row = select.closest('tr');
  row.querySelector('.price-input').value = selectedOption.value ? (parseFloat(selectedOption.dataset.price) || 0).toFixed(2) : '0';
  updateInvoiceTotal();
}

// Recalculate the running total as the user adds or changes line items
function updateInvoiceTotal() {
  let total = 0;
  document.querySelectorAll('#services-tbody-new tr').forEach(row => {
    const quantity = parseFloat(row.querySelector('.quantity-input')?.value) || 0;
    const price    = parseFloat(row.querySelector('.price-input')?.value)    || 0;
    total += quantity * price;
  });
  document.getElementById('invoice-total-preview').textContent = formatCurrency(total);
}

// Submit the new invoice — backend expects patient_id and items with service_id + quantity
async function submitCreateInvoice() {
  const patientId = document.getElementById('invoice-patient-select').value;
  if (!patientId) { showToast('Please select a patient', 'error'); return; }

  const items = [];
  document.querySelectorAll('#services-tbody-new tr').forEach(row => {
    const serviceId = row.querySelector('.service-select')?.value;
    const quantity  = parseInt(row.querySelector('.quantity-input')?.value) || 1;
    if (serviceId) items.push({ service_id: parseInt(serviceId), quantity });
  });

  if (!items.length) { showToast('Please select at least one service', 'error'); return; }

  try {
    await apiFetch('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({ patient_id: parseInt(patientId), items })
    });
    hideModal('create-invoice-modal');
    showToast('Invoice created successfully', 'success');
    loadInvoices();
  } catch (e) {
    showToast(e.message || 'Failed to create invoice', 'error');
  }
}

// Open the quick payment modal for a specific invoice
function openPaymentModal(invoiceId) {
  document.getElementById('pay-invoice-id').value = invoiceId;
  document.getElementById('pay-amount').value = '';
  document.getElementById('pay-method').value = 'Cash';
  document.getElementById('pay-ref').value = '';
  showModal('payment-modal');
}

// Submit a payment against an invoice
async function submitPayment() {
  const invoiceId = document.getElementById('pay-invoice-id').value;
  const amount    = parseFloat(document.getElementById('pay-amount').value);
  const method          = document.getElementById('pay-method').value;
  const referenceNumber = document.getElementById('pay-ref').value.trim();

  if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }

  try {
    await apiFetch('/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        invoice_id:     parseInt(invoiceId),
        amount_paid:    amount,
        payment_method: method,
        payment_date:   new Date().toISOString().split('T')[0],
        reference_no:   referenceNumber,
        received_by:    sessionStorage.getItem('name') || ''
      })
    });
    hideModal('payment-modal');
    showToast('Payment recorded successfully', 'success');
    loadInvoices();
  } catch (e) {
    showToast(e.message || 'Failed to record payment', 'error');
  }
}

// Re-apply filters whenever the user types in the search box or changes the status dropdown
document.getElementById('filter-patient').addEventListener('input', applyFilters);
document.getElementById('filter-status').addEventListener('change', applyFilters);

loadInvoices();

// If we arrived here with a patient pre-fill, open the create modal straight away
if (pendingPrefillPatientId) openCreateInvoice();
