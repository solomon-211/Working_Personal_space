const PAYSTACK_KEY = 'pk_test_3455a2b37d2f3525e62e5d89a0faa783b23d7c55';

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
  document.getElementById('invoice-due').textContent     = formatCurrency(inv.amount_due);
  document.getElementById('subtotal').textContent        = formatCurrency(inv.total_amount);
  document.getElementById('discount-display').textContent = formatCurrency(inv.discount || 0);
  document.getElementById('amount-due').textContent      = formatCurrency(inv.amount_due);
  document.title = `INV-${String(inv.invoice_id).padStart(4,'0')} — CCMS`;

  // Only show the "Add Payment" button if the invoice hasn't been fully paid yet
  if (inv.payment_status !== 'Paid') {
    document.getElementById('add-payment-btn').style.display = '';
  }

  renderServices(inv.items || []);

  // The GET /api/invoices/:id endpoint doesn't return payment history,
  // so we just show a placeholder message in that section
  const paymentsSection = document.getElementById('payments-list');
  if (paymentsSection) paymentsSection.innerHTML = '<p class="payment-empty">Payment history not available on this view.</p>';
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
  document.getElementById('pay-amount-due').value = invoiceData?.amount_due || 0;
  document.getElementById('pay-amount').value     = invoiceData?.amount_due || '';
  document.getElementById('pay-method').value     = 'Cash';
  ['cash-ref', 'card-email', 'card-network', 'card-last4', 'card-auth',
   'mobile-email', 'mobile-provider', 'mobile-number', 'mobile-txn',
   'ins-ref', 'ins-name', 'ins-claim', 'ins-auth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const due = invoiceData?.amount_due || 0;
  document.getElementById('pay-remaining-hint').textContent = due ? `Remaining: ${formatCurrency(due)}` : '';
  onMethodChange();
  showModal('payment-modal');
}

function onMethodChange() {
  const method = document.getElementById('pay-method').value;
  ['Cash', 'Card', 'Mobile', 'Insurance'].forEach(m => {
    document.getElementById(`fields-${m}`).style.display = m === method ? '' : 'none';
  });
  const isPaystack = method === 'Card' || method === 'Mobile';
  document.getElementById('pay-submit-btn').textContent = isPaystack ? 'Pay with Paystack' : 'Record Payment';
}

async function submitPayment() {
  const amount = parseFloat(document.getElementById('pay-amount').value);
  const method = document.getElementById('pay-method').value;

  if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }

  if (method === 'Card') {
    const email = document.getElementById('card-email').value.trim();
    if (!email) { showToast('Patient email is required for card payment', 'error'); return; }
    launchPaystack(amount, 'Card', email, ['card']);
  } else if (method === 'Mobile') {
    const email = document.getElementById('mobile-email').value.trim();
    if (!email) { showToast('Patient email is required for mobile payment', 'error'); return; }
    launchPaystack(amount, 'Mobile', email, ['mobile_money']);
  } else if (method === 'Cash') {
    const ref = document.getElementById('cash-ref').value.trim();
    await recordPayment(amount, 'Cash', ref);
  } else if (method === 'Insurance') {
    const ref   = document.getElementById('ins-ref').value.trim();
    const claim = document.getElementById('ins-claim').value.trim();
    if (!ref && !claim) { showToast('Enter a reference number or claim number', 'error'); return; }
    const combined = [
      document.getElementById('ins-name').value.trim(),
      ref || claim,
      document.getElementById('ins-auth').value.trim()
    ].filter(Boolean).join(' | ');
    await recordPayment(amount, 'Insurance', combined);
  }
}

function launchPaystack(amount, method, email, channels) {
  const handler = PaystackPop.setup({
    key:      PAYSTACK_KEY,
    email:    email,
    amount:   Math.round(amount * 100),
    currency: 'GHS',
    ref:      `INV-${invoiceId}-${Date.now()}`,
    channels: channels,
    metadata: { invoice_id: invoiceId },
    callback: async function(response) {
      let ref = response.reference;
      if (method === 'Card') {
        const network = document.getElementById('card-network').value.trim();
        const last4   = document.getElementById('card-last4').value.trim();
        if (network || last4) ref += ` | ${network} ${last4}`.trim();
      } else if (method === 'Mobile') {
        const provider = document.getElementById('mobile-provider').value.trim();
        const number   = document.getElementById('mobile-number').value.trim();
        if (provider || number) ref += ` | ${provider} ${number}`.trim();
      }
      await recordPayment(amount, method, ref);
    },
    onClose: function() {
      showToast('Payment cancelled', 'warning');
    }
  });
  handler.openIframe();
}

async function recordPayment(amount, method, ref) {
  try {
    await apiFetch('/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        invoice_id:     parseInt(invoiceId),
        amount_paid:    amount,
        payment_method: method,
        payment_date:   new Date().toISOString().split('T')[0],
        reference_no:   ref || '',
        received_by:    sessionStorage.getItem('name') || ''
      })
    });
    hideModal('payment-modal');
    showToast('Payment recorded', 'success');
    loadInvoice();
  } catch (e) {
    showToast(e.message || 'Failed to record payment', 'error');
  }
}

loadInvoice();
