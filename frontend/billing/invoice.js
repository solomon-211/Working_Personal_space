// Make sure the user is logged in before anything else runs
authGuard();
checkRole(['receptionist', 'admin']) || (location.href = '/dashboard/index.html');
checkSessionTimeout();

// Inject the shared header and sidebar, then apply role-based visibility
document.getElementById('header-slot').outerHTML = renderHeader();
document.getElementById('sidebar-slot').outerHTML = renderSidebar('billing');
applyRoleVisibility();

// Pull the invoice ID from the URL — if it's missing, send them back to billing
const invoiceId = new URLSearchParams(window.location.search).get('id');
if (!invoiceId) location.href = '/billing/index.html';

// We'll store the loaded invoice here so other functions can reference it
let invoiceData = null;

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

function renderPaymentHistory(payments) {
  const paymentsSection = document.getElementById('payments-list');
  if (!paymentsSection) return;

  if (!payments || payments.length === 0) {
    paymentsSection.innerHTML = '<p class="payment-empty">No payments recorded yet.</p>';
    return;
  }

  paymentsSection.innerHTML = payments.map(p => `
    <div class="payment-item">
      <div>
        <div class="payment-label">Date</div>
        <div>${formatDate(p.payment_date)}</div>
      </div>
      <div>
        <div class="payment-label">Method</div>
        <div>${p.payment_method || '—'}</div>
      </div>
      <div>
        <div class="payment-label">Amount</div>
        <div>${formatCurrency(p.amount_paid)}</div>
      </div>
      <div>
        <div class="payment-label">Received By</div>
        <div>${p.received_by || '—'}</div>
      </div>
      <div>
        <div class="payment-label">Reference</div>
        <div>${p.reference_no || '—'}</div>
      </div>
    </div>
  `).join('');
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

async function loadInvoice() {
  try {
    const res = await apiFetch(`/api/invoices/${invoiceId}`);
    invoiceData = res.invoice;
    renderInvoice();
  } catch (e) {
    showToast('Failed to load invoice', 'error');
  }
}

function renderInvoice() {
  const inv = invoiceData;
  const patientName = `${inv.first_name} ${inv.last_name} (${inv.clinic_number})`;

  // Fill in all the invoice header fields
  document.getElementById('invoice-number').textContent = `Invoice #INV-${String(inv.invoice_id).padStart(4,'0')}`;
  document.getElementById('invoice-patient').textContent = patientName;
  document.getElementById('invoice-date').textContent    = formatDate(inv.invoice_date);
  document.getElementById('invoice-status').outerHTML    = `<span id="invoice-status">${renderBadge(inv.payment_status)}</span>`;
  document.getElementById('invoice-total').textContent   = formatCurrency(inv.total_amount);
  document.getElementById('invoice-due').textContent     = formatCurrency(inv.remaining_balance ?? inv.amount_due);
  document.getElementById('subtotal').textContent        = formatCurrency(inv.total_amount);
  document.getElementById('discount-display').textContent = formatCurrency(inv.discount || 0);
  document.getElementById('amount-due').textContent      = formatCurrency(inv.remaining_balance ?? inv.amount_due);
  document.title = `INV-${String(inv.invoice_id).padStart(4,'0')} — CCMS`;

  // Only show the "Add Payment" button if the invoice hasn't been fully paid yet
  if (inv.payment_status !== 'Paid') {
    document.getElementById('add-payment-btn').style.display = '';
  }

  renderServices(inv.items || []);
  renderPaymentHistory(inv.payments || []);
}

function renderServices(items) {
  const tbody = document.getElementById('services-tbody');

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-text">No services recorded</div></div></td></tr>';
    return;
  }

  tbody.innerHTML = items.map(item => `
    <tr>
      <td data-label="Service">${item.service_name}</td>
      <td data-label="Category">${item.category || '—'}</td>
      <td class="numeric" data-label="Qty">${item.quantity}</td>
      <td class="numeric" data-label="Unit Price">${formatCurrency(item.unit_price)}</td>
      <td class="numeric" data-label="Subtotal">${formatCurrency(item.subtotal)}</td>
    </tr>`).join('');
}

function openPaymentModal() {
  clearPaymentError();
  // Clear out any previous values before showing the modal
  document.getElementById('pay-amount').value = '';
  document.getElementById('pay-method').value = 'Cash';
  document.getElementById('pay-ref').value    = '';
  renderPaymentExtraFields('Cash');

  const remaining = invoiceData?.remaining_balance ?? invoiceData?.amount_due;
  const remainingEl = document.getElementById('pay-remaining');
  if (remainingEl) {
    remainingEl.textContent = remaining === undefined || remaining === null
      ? 'Remaining: —'
      : `Remaining: ${formatCurrency(remaining)}`;
  }

  showModal('payment-modal');
}

async function submitPayment() {
  clearPaymentError();
  const amount = parseFloat(document.getElementById('pay-amount').value);
  const method = document.getElementById('pay-method').value;
  const ref    = document.getElementById('pay-ref').value.trim();

  if (!amount || amount <= 0) { showPaymentError('Enter a valid amount.'); return; }

  const remaining = Number(invoiceData?.remaining_balance ?? invoiceData?.amount_due);
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
    showToast('Payment recorded', 'success');
    // Reload the invoice so the status and due amount update
    loadInvoice();
  } catch (e) {
    showPaymentError(e.message || 'Failed to record payment');
  }
}

document.getElementById('pay-method').addEventListener('change', (e) => {
  clearPaymentError();
  renderPaymentExtraFields(e.target.value);
});

loadInvoice();
