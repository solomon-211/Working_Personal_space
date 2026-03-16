authGuard();
checkRole(['receptionist', 'admin']) || (location.href = '/dashboard/index.html');
applyRoleVisibility();
checkSessionTimeout();

const currentUsername = sessionStorage.getItem('name') || 'User';
const currentRole = sessionStorage.getItem('role') || 'Guest';
document.getElementById('user-name').textContent = currentUsername;
document.getElementById('user-role').textContent = currentRole;
document.getElementById('user-role').classList.add(currentRole);

let pendingPrefillInvoicePatientId = sessionStorage.getItem('prefillInvoicePatientId');
let allInvoices = [];

function toggleSidebar() {
  document.querySelector('aside').classList.toggle('open');
}

async function loadInvoices() {
  const container = document.getElementById('invoices-list');
  try {
    const response = await apiFetch('/api/invoices');
    allInvoices = response?.invoices || [];
    applyFilters();
  } catch (error) {
    container.innerHTML = '<tr><td colspan="7" class="text-error">Failed to load invoices</td></tr>';
  }
}

function applyFilters() {
  const search = document.getElementById('filter-patient').value.trim().toLowerCase();
  const status = document.getElementById('filter-status').value;

  const filtered = allInvoices.filter((inv) => {
    const name = `${inv.first_name} ${inv.last_name}`.toLowerCase();
    const clinic = (inv.clinic_number || '').toLowerCase();
    if (search && !name.includes(search) && !clinic.includes(search)) return false;
    if (status && inv.payment_status !== status) return false;
    return true;
  });

  renderInvoices(filtered);
}

function renderInvoices(invoices) {
  const container = document.getElementById('invoices-list');
  if (!invoices.length) {
    container.innerHTML = '<tr><td colspan="7" class="text-muted-center">No invoices found</td></tr>';
    return;
  }

  container.innerHTML = invoices.map((invoice) => {
    const statusColor = invoice.payment_status === 'Paid'
      ? 'success'
      : invoice.payment_status === 'Partial'
        ? 'warning'
        : 'danger';

    return `
      <tr>
        <td><strong>INV-${String(invoice.invoice_id).padStart(4, '0')}</strong></td>
        <td>${invoice.first_name} ${invoice.last_name}<br><small class="patient-subtext">${invoice.clinic_number}</small></td>
        <td>${formatDate(invoice.invoice_date)}</td>
        <td>${formatCurrency(invoice.total_amount)}</td>
        <td>${formatCurrency(invoice.amount_due)}</td>
        <td><span class="status-badge status-${statusColor}">${invoice.payment_status}</span></td>
        <td>
          <div class="action-buttons">
            <button class="btn btn-small btn-primary" onclick="viewInvoice('${invoice.invoice_id}')">View</button>
            <button class="btn btn-small btn-secondary" onclick="recordPayment('${invoice.invoice_id}')">Record Payment</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function createInvoice() {
  showModal('create-invoice-modal');
  loadPatientsForInvoice();
}

async function loadPatientsForInvoice() {
  try {
    const response = await apiFetch('/api/patients');
    const select = document.getElementById('invoice-patient-select');
    select.innerHTML = '<option value="">Select Patient</option>';

    (response?.patients || []).forEach((patient) => {
      const opt = document.createElement('option');
      opt.value = patient.patient_id;
      opt.textContent = `${patient.first_name} ${patient.last_name} (${patient.clinic_number})`;
      select.appendChild(opt);
    });

    if (pendingPrefillInvoicePatientId) {
      select.value = String(pendingPrefillInvoicePatientId);
      pendingPrefillInvoicePatientId = null;
      sessionStorage.removeItem('prefillInvoicePatientId');
    }
  } catch (e) {
    // Keep modal open; user can retry.
  }
}

function addServiceRow() {
  const tbody = document.getElementById('services-tbody-new');
  const tr = document.createElement('tr');

  tr.innerHTML = `
    <td><input type="text" class="service-input" placeholder="Service name" /></td>
    <td><input type="number" class="qty-input" value="1" min="1" onchange="updateInvoiceTotal()" /></td>
    <td><input type="number" class="price-input" value="0" min="0" step="0.01" onchange="updateInvoiceTotal()" /></td>
    <td><button type="button" class="remove-row-btn" onclick="this.closest('tr').remove();updateInvoiceTotal();">X</button></td>
  `;

  tbody.appendChild(tr);
}

function updateInvoiceTotal() {
  const rows = document.querySelectorAll('#services-tbody-new tr');
  let total = 0;

  rows.forEach((row) => {
    const qty = parseFloat(row.querySelector('td:nth-child(2) input').value) || 0;
    const price = parseFloat(row.querySelector('td:nth-child(3) input').value) || 0;
    total += qty * price;
  });

  document.getElementById('invoice-total-preview').textContent = formatCurrency(total);
}

async function submitCreateInvoice() {
  const patientId = document.getElementById('invoice-patient-select').value;
  if (!patientId) {
    showToast('Please select a patient', 'warning');
    return;
  }

  const rows = document.querySelectorAll('#services-tbody-new tr');
  const services = [];

  rows.forEach((row) => {
    const name = row.querySelector('td:nth-child(1) input').value.trim();
    const qty = parseInt(row.querySelector('td:nth-child(2) input').value, 10) || 1;
    const price = parseFloat(row.querySelector('td:nth-child(3) input').value) || 0;
    if (name) {
      services.push({ service_name: name, quantity: qty, unit_price: price });
    }
  });

  if (!services.length) {
    showToast('Please add at least one service', 'warning');
    return;
  }

  try {
    await apiFetch('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({ patient_id: patientId, services })
    });

    hideModal('create-invoice-modal');
    showToast('Invoice created successfully', 'success');
    loadInvoices();
  } catch (e) {
    showToast(e.message || 'Failed to create invoice', 'error');
  }
}

async function recordPayment(invoiceId) {
  const amount = prompt('Enter payment amount (SSP):');
  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    showToast('Invalid payment amount', 'error');
    return;
  }

  const method = prompt('Payment method (Cash/Card/Insurance):', 'Cash') || 'Cash';
  const today = new Date().toISOString().split('T')[0];

  try {
    await apiFetch('/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        invoice_id: invoiceId,
        amount_paid: parseFloat(amount),
        payment_method: method,
        payment_date: today
      })
    });

    showToast('Payment recorded successfully', 'success');
    loadInvoices();
  } catch (e) {
    showToast(e.message || 'Failed to record payment', 'error');
  }
}

function viewInvoice(invoiceId) {
  location.href = `/billing/invoice.html?id=${invoiceId}`;
}

loadInvoices();

document.getElementById('filter-patient').addEventListener('input', applyFilters);
document.getElementById('filter-status').addEventListener('change', applyFilters);

if (pendingPrefillInvoicePatientId) {
  createInvoice();
}