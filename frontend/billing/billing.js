const PAYSTACK_KEY = 'pk_test_3455a2b37d2f3525e62e5d89a0faa783b23d7c55';

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
          ${inv.payment_status !== 'Paid' ? `<button class="btn btn-primary btn-sm" onclick="openPaymentModal(${inv.invoice_id}, ${inv.amount_due})">Pay</button>` : ''}
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
function openPaymentModal(invoiceId, amountDue) {
  document.getElementById('pay-invoice-id').value = invoiceId;
  document.getElementById('pay-amount-due').value = amountDue || 0;
  document.getElementById('pay-amount').value     = amountDue || '';
  document.getElementById('pay-method').value     = 'Cash';
  // Clear all fields
  ['cash-ref', 'card-email', 'card-network', 'card-last4', 'card-auth',
   'mobile-email', 'mobile-provider', 'mobile-number', 'mobile-txn',
   'ins-ref', 'ins-name', 'ins-claim', 'ins-auth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('pay-remaining-hint').textContent = amountDue ? `Remaining: ${formatCurrency(amountDue)}` : '';
  onMethodChange();
  showModal('payment-modal');
}

// Show only the fields relevant to the selected method
function onMethodChange() {
  const method = document.getElementById('pay-method').value;
  ['Cash', 'Card', 'Mobile', 'Insurance'].forEach(m => {
    document.getElementById(`fields-${m}`).style.display = m === method ? '' : 'none';
  });
  const isPaystack = method === 'Card' || method === 'Mobile';
  document.getElementById('pay-submit-btn').textContent = isPaystack ? 'Pay with Paystack' : 'Record Payment';
}

// Route to Paystack or manual depending on method
async function submitPayment() {
  const invoiceId = document.getElementById('pay-invoice-id').value;
  const amount    = parseFloat(document.getElementById('pay-amount').value);
  const method    = document.getElementById('pay-method').value;

  if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }

  if (method === 'Card') {
    const email = document.getElementById('card-email').value.trim();
    if (!email) { showToast('Patient email is required for card payment', 'error'); return; }
    launchPaystack(invoiceId, amount, 'Card', email, ['card']);
  } else if (method === 'Mobile') {
    const email = document.getElementById('mobile-email').value.trim();
    if (!email) { showToast('Patient email is required for mobile payment', 'error'); return; }
    launchPaystack(invoiceId, amount, 'Mobile', email, ['mobile_money']);
  } else if (method === 'Cash') {
    const ref = document.getElementById('cash-ref').value.trim();
    await recordPayment(invoiceId, amount, 'Cash', ref);
  } else if (method === 'Insurance') {
    const ref  = document.getElementById('ins-ref').value.trim();
    const claim = document.getElementById('ins-claim').value.trim();
    if (!ref && !claim) { showToast('Enter a reference number or claim number', 'error'); return; }
    const combined = [
      document.getElementById('ins-name').value.trim(),
      ref || claim,
      document.getElementById('ins-auth').value.trim()
    ].filter(Boolean).join(' | ');
    await recordPayment(invoiceId, amount, 'Insurance', combined);
  }
}

// Launch Paystack popup — on success auto-fills reference and saves to DB
function launchPaystack(invoiceId, amount, method, email, channels) {
  const handler = PaystackPop.setup({
    key:      PAYSTACK_KEY,
    email:    email,
    amount:   Math.round(amount * 100),
    currency: 'GHS',
    ref:      `INV-${invoiceId}-${Date.now()}`,
    channels: channels,
    metadata: { invoice_id: invoiceId },
    callback: async function(response) {
      // Paystack confirmed — build reference string with extra card/mobile details
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
      await recordPayment(invoiceId, amount, method, ref);
    },
    onClose: function() {
      showToast('Payment cancelled', 'warning');
    }
  });
  handler.openIframe();
}

// POST payment to backend — used by all 4 methods
async function recordPayment(invoiceId, amount, method, ref) {
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
