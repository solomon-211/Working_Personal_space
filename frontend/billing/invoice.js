authGuard();
checkRole(['receptionist', 'admin']) || (location.href = '/dashboard/index.html');
applyRoleVisibility();
checkSessionTimeout();

const currentUsername = sessionStorage.getItem('name') || 'User';
const currentRole = sessionStorage.getItem('role') || 'Guest';
document.getElementById('user-name').textContent = currentUsername;
document.getElementById('user-role').textContent = currentRole;
document.getElementById('user-role').classList.add(currentRole);

const invoiceId = new URLSearchParams(window.location.search).get('id');
if (!invoiceId) {
  location.href = '/billing/index.html';
}

let invoiceData = {};

function toggleSidebar() {
  document.querySelector('aside').classList.toggle('open');
}

async function loadInvoice() {
  try {
    const response = await apiFetch(`/api/invoices/${invoiceId}`);
    invoiceData = response.invoice;
    renderInvoice();
  } catch (error) {
    showToast('Failed to load invoice', 'error');
  }
}

function renderInvoice() {
  const inv = invoiceData;
  const patientName = `${inv.first_name} ${inv.last_name}`;
  const status = inv.payment_status;
  const statusClass = status === 'Paid' ? 'success' : status === 'Partial' ? 'warning' : 'danger';

  document.getElementById('invoice-number').textContent = `Invoice #INV-${String(inv.invoice_id).padStart(4, '0')}`;
  document.getElementById('invoice-date').textContent = formatDate(inv.invoice_date);
  document.getElementById('invoice-patient').textContent = `${patientName} (${inv.clinic_number})`;
  document.getElementById('invoice-status').textContent = status;
  document.getElementById('invoice-status').className = `status-badge status-${statusClass}`;
  document.getElementById('invoice-due').textContent = formatCurrency(inv.amount_due);
  document.getElementById('discount').value = inv.discount || 0;

  renderServices();
  renderPayments();
  updateTotals();
}

function renderServices() {
  const tbody = document.getElementById('services-tbody');
  let html = '';
  const services = invoiceData.items || invoiceData.services || [];

  services.forEach((service) => {
    const subtotal = service.quantity * service.unit_price;
    html += `
      <tr>
        <td data-label="Service">${service.service_name}</td>
        <td class="numeric" data-label="Qty">${service.quantity}</td>
        <td class="numeric" data-label="Unit Price">${formatCurrency(service.unit_price)}</td>
        <td class="numeric" data-label="Subtotal">${formatCurrency(subtotal)}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function renderPayments() {
  const container = document.getElementById('payments-list');
  const payments = invoiceData.payments || [];

  if (!payments.length) {
    container.innerHTML = '<p class="payment-empty">No payments recorded</p>';
    return;
  }

  let html = '';
  payments.forEach((payment) => {
    html += `
      <div class="payment-item">
        <div>
          <div class="payment-label">Date</div>
          <div>${formatDate(payment.payment_date)}</div>
        </div>
        <div>
          <div class="payment-label">Amount</div>
          <div>${formatCurrency(payment.amount_paid)}</div>
        </div>
        <div>
          <div class="payment-label">Method</div>
          <div>${payment.payment_method || '-'}</div>
        </div>
        <div>
          <div class="payment-label">Reference</div>
          <div>${payment.reference_no || '-'}</div>
        </div>
        <div class="payment-right">
          <div class="payment-label">Received By</div>
          <div>${payment.received_by || '-'}</div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function updateTotals() {
  const services = invoiceData.items || invoiceData.services || [];
  const subtotal = services.reduce((sum, s) => sum + (s.quantity * s.unit_price), 0);
  const discount = parseFloat(document.getElementById('discount').value) || 0;
  const amountDue = Math.max(0, subtotal - discount);

  document.getElementById('subtotal').textContent = formatCurrency(subtotal);
  document.getElementById('amount-due').textContent = formatCurrency(amountDue);
}

async function addPayment() {
  const amount = prompt('Enter payment amount (SSP):');
  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) return;

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

    showToast('Payment recorded', 'success');
    loadInvoice();
  } catch (e) {
    showToast(e.message || 'Failed to record payment', 'error');
  }
}

loadInvoice();