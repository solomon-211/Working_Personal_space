# Changelog

All changes made since the last commit, grouped by feature.

---

## [1] Fix: Load .env file in config.py

**File:** `backend/config.py`

Added `python-dotenv` import and `load_dotenv()` call so environment variables
from `backend/.env` are loaded at startup. Without this, `DB_PASSWORD` and other
variables were never read, causing every login attempt to fail with
"Database unavailable".

```diff
+ from dotenv import load_dotenv
+ load_dotenv()
```

---

## [2] Fix: Correct SHA-256 password hashes in test data

**File:** `db_setup/test_data.sql`

The original user inserts had truncated 21-character hashes. SHA-256 always
produces 64 hex characters. The login route compares full hashes, so all
logins were failing with 401. Replaced with correct full-length hashes.

| Username | Password | Old hash (truncated) | Fixed |
|---|---|---|---|
| `admin.juba` | `admin123` | `e3b0c44298fc1c149afb` | ✅ 64 chars |
| `amina.lado` | `amina123` | `c4ca4238a0b923820dcc` | ✅ 64 chars |
| `john.ladu` | `john123` | `c81e728d9d4c2f636f06` | ✅ 64 chars |
| `j.lual` | `doctor123` | `a87ff679a2f3e71d9181` | ✅ 64 chars |
| `g.akuei` | `doctor123` | `eccbc87e4b5ce2fe2830` | ✅ 64 chars |

---

## [3] Fix: timedelta not JSON serializable in doctor schedules

**File:** `backend/routes/doctors.py`

MySQL returns `TIME` columns as Python `timedelta` objects. Flask's `jsonify`
cannot serialize `timedelta`, causing a 500 error on `GET /api/doctor-schedules`.
Fixed by converting `start_time` to a string after fetching, before caching or
returning the response.

```diff
+ for s in schedules:
+     if hasattr(s.get('start_time'), 'seconds'):
+         s['start_time'] = str(s['start_time'])
```

---

## [4] Feature: Invoice status counts on patient list

**File:** `backend/routes/patients.py`

Both patient list queries (search and full list) now use conditional aggregation
via LEFT JOINs on `medical_visits` and `invoices` to return two extra fields
per patient:

- `pending_invoice_count` — visits that exist but have no invoice yet
- `invoiced_count` — visits that already have an invoice

These are calculated server-side in a single SQL query with no extra API calls.

```diff
+ SUM(i.invoice_id IS NULL AND v.visit_id IS NOT NULL) AS pending_invoice_count,
+ SUM(i.invoice_id IS NOT NULL)                        AS invoiced_count
+ FROM patients p
+ LEFT JOIN medical_visits v ON v.patient_id = p.patient_id
+ LEFT JOIN invoices       i ON i.visit_id   = v.visit_id
+ GROUP BY p.patient_id
```

---

## [5] Feature: has_invoice and linked_invoice_id on medical visits

**File:** `backend/routes/medical_visits.py`

The `GET /api/medical-visits/:patient_id` query now LEFT JOINs the `invoices`
table so each visit row includes:

- `has_invoice` — `1` if an invoice exists for this visit, `0` if not
- `linked_invoice_id` — the invoice ID to link to directly

```diff
+ CASE WHEN i.invoice_id IS NOT NULL THEN 1 ELSE 0 END AS has_invoice,
+ i.invoice_id AS linked_invoice_id
+ LEFT JOIN invoices i ON i.visit_id = v.visit_id
```

---

## [6] Feature: IndexedDB offline cache (idbCache)

**File:** `frontend/assets/js/utils.js`

Added `idbCache` — a browser-side fallback cache using IndexedDB. It operates
as a fallback, not a primary cache. The flow inside `apiFetch()`:

- On successful GET response → silently write to IndexedDB keyed by endpoint URL
- On fetch failure → check IndexedDB for a cached response
- If found → show "Showing cached data — backend unreachable" warning toast and return stale data
- If not found → show error toast and throw

Only GET requests are cached. POST/PATCH are never stored or served from cache.
No TTL — holds the last known good response until overwritten.

This allows clinic staff to continue viewing data during server downtime, which
is critical given unreliable power supply in South Sudan.

```diff
+ const idbCache = (() => {
+   // opens hb-cache IndexedDB with a single 'responses' object store
+   // get(key) — reads cached response by endpoint URL
+   // set(key, value) — writes response to cache
+ })();
+
+ // in apiFetch() — write on success:
+ if (isGet && data) {
+   idbCache.set(endpoint, data).catch(() => {});
+ }
+
+ // in apiFetch() catch block — read on failure:
+ const cached = await idbCache.get(endpoint).catch(() => null);
+ if (cached) {
+   showToast('Showing cached data — backend unreachable', 'warning');
+   return cached;
+ }
```

---

## [7] Feature: Invoice status buttons on patient list

**File:** `frontend/patients/list.js`

Added invoice status indicators to each patient row for admin and receptionist
roles, using the `pending_invoice_count` and `invoiced_count` fields from the API:

- Amber **"Needs Invoice"** button — patient has visits with no invoice
- Green **"Invoiced"** button — all visits have invoices
- No button shown for doctors or when no visits exist

Added `goToInvoice(patientId)` which navigates to
`profile.html?id=X#billing`.

```diff
+ const needsInvoice = isAdminOrRec && (patient.pending_invoice_count || 0) > 0;
+ const hasInvoiced  = isAdminOrRec && (patient.invoiced_count || 0) > 0;
+ const invoiceBtn   = needsInvoice
+   ? `<button ...>Needs Invoice</button>`
+   : hasInvoiced
+     ? `<button ...>Invoiced</button>`
+     : '';
+
+ function goToInvoice(patientId) {
+   location.href = `/patients/profile.html?id=${patientId}#billing`;
+ }
```

---

## [8] Feature: Generate Invoice / View Invoice on patient profile visits tab

**File:** `frontend/patients/profile.js`

Added `renderVisitInvoiceCell(visit, role)` which replaces the old hardcoded
"Invoice" button in the visits table. It now shows:

- **"View Invoice"** link — if `has_invoice === 1`, links directly to the invoice
- **"Generate Invoice"** button — if no invoice and role is admin or receptionist
- **"Pending Invoice"** text — if no invoice and role is doctor (read-only)

Also fixed `submitInvoice()`:
- Now passes `visit_id` in the POST body so the invoice is linked to the visit
- On success calls `loadVisits()` and `loadBilling()` in-place instead of
  redirecting — the button updates to "View Invoice" without a page reload

```diff
+ function renderVisitInvoiceCell(visit, role) {
+   if (Number(visit.has_invoice) === 1)
+     return `<a href="/billing/invoice.html?id=${visit.linked_invoice_id}">View Invoice</a>`;
+   if (role === 'admin' || role === 'receptionist')
+     return `<button onclick="openInvoiceModal(...)">Generate Invoice</button>`;
+   return '<span>Pending Invoice</span>';
+ }
+
+ // submitInvoice — visit_id now included:
+ body: JSON.stringify({ patient_id, visit_id: invoiceVisitId, items, discount })
+
+ // on success — reload in place instead of redirect:
+ loadVisits();
+ loadBilling();
```

---

## [9] Fix: Operational report missing No-show Rate and Scheduled Rate

**File:** `frontend/reports/reports.js`

The operational report only calculated `completion_rate` and `cancellation_rate`.
`no_show_rate` and `scheduled_rate` were never computed, so they showed as `0.0%`.

Fixed by replacing two hardcoded `find()` calls with a reusable `count(status)`
helper, and adding both missing rates to `reportData` and `renderSummaryCards`.

```diff
+ const count = status => Number(byStatus.find(r => r.status === status)?.count || 0);
  reportData = {
    completion_rate:    total ? (count('Completed') / total * 100) : 0,
    cancellation_rate:  total ? (count('Cancelled') / total * 100) : 0,
+   no_show_rate:       total ? (count('No-show')   / total * 100) : 0,
+   scheduled_rate:     total ? (count('Scheduled') / total * 100) : 0,
  };

+ html += card('No-show Rate',   reportData.no_show_rate.toFixed(1)   + '%');
+ html += card('Scheduled Rate', reportData.scheduled_rate.toFixed(1) + '%');
```

---

## [10] Feature: Paystack payment integration

**Files:** `backend/routes/billing.py`, `frontend/billing/billing.js`,
`frontend/billing/invoice.js`, `frontend/billing/index.html`,
`frontend/billing/invoice.html`

### Backend — two new routes added to `billing.py`

**`POST /api/paystack/initialize`**
Calls Paystack's `/transaction/initialize` API server-side using the secret key
(which never leaves the backend). Returns `reference` and `access_code` to the
frontend.

**`GET /api/paystack/verify/:reference`**
Calls Paystack's `/transaction/verify/:reference` API to confirm the payment
actually succeeded before saving anything to the database. Returns verified
amount, card type, last4, and mobile number from Paystack's response.

### Frontend — payment modal rebuilt with method-specific fields

The single generic payment modal was replaced with four method-specific field
sections that show/hide based on the selected payment method:

| Method | Fields | Gateway |
|---|---|---|
| Cash | Reference No. (optional) | None — saved directly |
| Card | Patient Email (required) | Paystack popup |
| Mobile | Patient Email (required) | Paystack popup |
| Insurance | Reference No., Insurer Name, Claim Number, Auth Code | None — saved directly |

### Card / Mobile payment flow

1. Staff enters amount and patient email
2. Frontend calls `POST /api/paystack/initialize` — secret key stays on server
3. Paystack popup opens using `access_code` — card/mobile details entered inside Paystack's secure UI
4. On success, Paystack calls `onPaystackSuccess(response)` with a `reference`
5. Frontend calls `GET /api/paystack/verify/:reference` — Flask confirms with Paystack
6. Only after verification passes → `POST /api/payments` saves to DB with Paystack reference

### Paystack inline script added to both billing pages

```diff
+ <script src="https://js.paystack.co/v1/inline.js"></script>
```

---

## [11] New file: backend/.env

Created `backend/.env` with correct database credentials so `load_dotenv()` in
`config.py` can find it. Previously the `.env` was misplaced inside `backend/routes/`
and was never loaded.

---

## [12] New file: README.md

Created `README.md` at the project root documenting the full system — project
structure, setup guide, test accounts, API reference, frontend pages, all key
features, environment variables, database schema, and dependencies.
