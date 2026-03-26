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

Added `goToInvoice(patientId)` which navigates to `profile.html?id=X#billing`.

---

## [8] Feature: Generate Invoice / View Invoice on patient profile visits tab

**File:** `frontend/patients/profile.js`

Added `renderVisitInvoiceCell(visit, role)` which replaces the old hardcoded
"Invoice" button in the visits table. It now shows:

- **"View Invoice"** link — if `has_invoice === 1`, links directly to the invoice
- **"Generate Invoice"** button — if no invoice and role is admin or receptionist
- **"Pending Invoice"** text — if no invoice and role is doctor (read-only)

Also fixed `submitInvoice()` to pass `visit_id` in the POST body and reload
in-place instead of redirecting after success.

---

## [9] Fix: Operational report missing No-show Rate and Scheduled Rate

**File:** `frontend/reports/reports.js`

The operational report only calculated `completion_rate` and `cancellation_rate`.
`no_show_rate` and `scheduled_rate` were never computed, so they showed as `0.0%`.
Fixed by adding a reusable `count(status)` helper and adding both missing rates
to `reportData` and `renderSummaryCards`.

---

## [10] Feature: Paystack payment integration

**Files:** `backend/routes/billing.py`, `frontend/billing/billing.js`,
`frontend/billing/invoice.js`, `frontend/billing/index.html`,
`frontend/billing/invoice.html`

Two new backend routes: `POST /api/paystack/initialize` and
`GET /api/paystack/verify/:reference`. The secret key never leaves the server.
Payment modal rebuilt with method-specific fields for Cash, Card, Mobile, and
Insurance. Card and Mobile go through Paystack's secure popup with backend
verification before saving to DB.

---

## [11] New file: backend/.env

Created `backend/.env` in the correct location so `load_dotenv()` in
`config.py` can find it.

---

## [12] New file: README.md

Created `README.md` documenting setup guide, test accounts, API reference,
and key features.

---

## [13] Fix: SQL alias error in appointment booking

**File:** `backend/routes/appointments.py`

The double-booking check query referenced `a.status` but the table had no alias
`a`, causing a 503 error on every `POST /api/appointments`.

```diff
- AND a.status = 'Scheduled'
+ AND status   = 'Scheduled'
```

---

## [14] Fix: visit_id not saved when creating invoice

**File:** `backend/routes/billing.py`

The `POST /api/invoices` INSERT was missing `visit_id` in the column list so it
was always saved as `NULL`. This caused `has_invoice` to stay 0 for the visit,
meaning "Generate Invoice" never flipped to "View Invoice" after creation.

Also added `cache_invalidate('patients')` and `cache_invalidate('medical-visits')`
after invoice creation so the patient list and visit invoice status update
immediately without waiting for cache TTL expiry.

```diff
- INSERT INTO invoices (patient_id, appointment_id, ...)
+ INSERT INTO invoices (patient_id, visit_id, appointment_id, ...)
```

---

## [15] Feature: idbCache invalidation on mutations

**File:** `frontend/assets/js/utils.js`

Added two new methods to `idbCache`:

- `del(key)` — deletes a single cache entry by exact key
- `invalidate(prefix)` — deletes all entries whose key starts with a given prefix

Added automatic cache invalidation inside `apiFetch` after any successful
POST/PATCH/DELETE based on an invalidation map:

| Mutation endpoint | Clears |
|---|---|
| `/api/invoices` | `/api/patients`, `/api/invoices`, `/api/medical-visits` |
| `/api/payments` | `/api/invoices` |
| `/api/patients` | `/api/patients` |
| `/api/appointments` | `/api/appointments` |
| `/api/medical-visits` | `/api/medical-visits`, `/api/patients` |
| `/api/prescriptions` | `/api/prescriptions` |
| `/api/diagnoses` | `/api/medical-visits` |

---

## [16] Fix: Patient list always fetches fresh data on load

**File:** `frontend/patients/list.js`

`loadPatients()` now accepts a `bustCache` parameter. The initial page load
calls `loadPatients('', true)` which clears the `/api/patients` IndexedDB cache
before fetching. This ensures navigating back after creating an invoice always
shows the correct "Invoiced" status instead of stale "Needs Invoice".

Removed dead `editPatient()` function that only showed a "coming soon" toast.

---

## [17] Fix: Invoice creation updates visit button in real time

**File:** `frontend/patients/profile.js`

After `submitInvoice()` succeeds, the code now explicitly awaits
`idbCache.invalidate()` for `/api/medical-visits`, `/api/invoices`, and
`/api/patients` before calling `loadVisits()` and `loadBilling()`. This
guarantees the cache is cleared before the next fetch, so "Generate Invoice"
immediately changes to "View Invoice" without a page reload.

Removed dead `?edit=true` URL parameter check — no page navigates to
`profile.html?edit=true`.

---

## [18] Feature: Pie charts for financial and operational reports

**File:** `frontend/reports/reports.js`

Added pie charts to two previously chart-less report types:

- **Financial** — "Revenue by Payment Method" showing Cash, Insurance, Card,
  and Mobile slices with SSP amounts and percentages
- **Operational** — "Appointments by Status" showing Completed, No-show,
  Cancelled, and Scheduled slices with counts and percentages

Removed the **Avg Wait Time** summary card from the operational report — it
always showed 0 since `analytics_snapshots` has no relevant data.

---

## [19] Fix: btn-warning CSS class missing

**File:** `frontend/assets/css/style.css`

The "Needs Invoice" button used `btn-warning` which was never defined,
causing it to render with no background. Added amber-yellow `#F59E0B` which
pairs visually with the green `btn-success` used for "Invoiced".

---

## [20] Fix: Approved step persists across page refreshes

**File:** `frontend/appointments/appointments.js`

`viewApprovedIds` was a plain `Set` that reset on every page refresh. Changed
to read from and write to `sessionStorage` via a `persistApproved()` helper so
approvals survive for the duration of the doctor's session and clear on logout.

Removed `confirm()` browser popup from `cancelAppointment()` — replaced with
direct action consistent with the toast-based UX used everywhere else.
