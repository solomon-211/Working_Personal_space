# HealthHub Bridge — Clinic & Care Management System

A web-based clinic management system built with Flask, MySQL, and vanilla HTML/CSS/JS.
Designed to replace paper-based record keeping in medical facilities, covering patient
registration, appointments, doctor consultations, medical visits, prescriptions, and billing.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Running the Project](#running-the-project)
3. [User Roles & Permissions](#user-roles--permissions)
4. [API Endpoints](#api-endpoints)
5. [Key Business Rules](#key-business-rules)
6. [Changelog](#changelog)
   - [Database Changes](#database-changes)
   - [Billing & Invoicing](#billing--invoicing)
   - [Appointments](#appointments)
   - [UI & Navigation](#ui--navigation)
   - [Reports](#reports)

---

## Prerequisites

| Tool | Version |
|---|---|
| Python | 3.10+ |
| MySQL | 8.0+ |
| VS Code + Live Server extension | Any |

---

## Running the Project

**1 — Start MySQL** and connect:
```bash
mysql -u root -p
```

**2 — Set up the database** (run in order inside the MySQL prompt):
```sql
SOURCE db_setup/clinic_db.sql;
SOURCE db_setup/add_unique_invoice_appointment_index.sql;
SOURCE db_setup/add_visit_id_to_invoices.sql;
SOURCE db_setup/test_data.sql;
```
> Skip `test_data.sql` for a clean empty database.

**3 — Install dependencies:**
```bash
cd backend
pip install -r requirements.txt
```

**4 — Configure backend** — create `backend/.env`:
```env
DB_PASSWORD=your_mysql_root_password
SECRET_KEY=any-random-string
```

**5 — Start the backend:**
```bash
python app.py
```
API runs at `http://localhost:5000`

**6 — Serve the frontend** — open `frontend/` in VS Code, right-click `index.html` → **Open with Live Server** (must use port **5500**)

**7 — Log in** at `http://127.0.0.1:5500`:

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Admin |
| `doctor1` | `doctor123` | Doctor |
| `receptionist1` | `recep123` | Receptionist |

---

## User Roles & Permissions

| Feature | Admin | Receptionist | Doctor |
|---|---|---|---|
| View patients | ✅ | ✅ | ✅ |
| Register / edit patients | ✅ | ✅ | ❌ |
| Schedule / cancel appointments | ✅ | ✅ | ❌ |
| Run consultations | ❌ | ❌ | ✅ |
| Create invoices | ✅ | ✅ | ❌ |
| Record payments | ✅ | ✅ | ❌ |
| View reports | ✅ | ❌ | ✅ |
| Manage doctors | ✅ | ❌ | ❌ |

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET/POST | `/api/patients` | List / register patients |
| GET/PATCH | `/api/patients/:id` | Get / update patient |
| GET | `/api/doctors` | List active doctors |
| GET | `/api/doctor-schedules` | List all doctor schedules |
| GET | `/api/doctor-schedules/:id` | Get available slots for a doctor |
| GET/POST | `/api/appointments` | List / book appointments |
| PATCH | `/api/appointments/:id` | Update appointment status |
| GET | `/api/appointments/upcoming` | List upcoming scheduled appointments |
| GET/POST | `/api/medical-visits/:patient_id` | Get / create visit records |
| POST | `/api/diagnoses` | Add diagnosis to visit |
| GET/POST | `/api/prescriptions/:patient_id` | Get / add prescriptions |
| GET/POST | `/api/invoices` | List / create invoices |
| GET | `/api/invoices/:id` | Get invoice with payments |
| POST | `/api/payments` | Record payment |
| GET | `/api/reports/financial` | Financial report for a date range |
| GET | `/api/reports/clinical` | Clinical report for a date range |
| GET | `/api/reports/operational` | Operational report for a date range |

---

## Key Business Rules

- **One visit = one invoice** — enforced by DB unique constraint and API 409 check.
- **Invoice requires a completed consultation** — doctor must submit the consultation form first.
- **Only admin/receptionist can create invoices** — doctors can view but not bill.
- **Payments cannot exceed the remaining balance.**
- **Non-cash payments require a reference** — card last 4, mobile transaction ID, or insurance claim number.
- **Past scheduled appointments auto-expire to No-show** — any appointment whose date passes without being actioned is automatically marked as No-show when the dashboard loads.
- **Sessions expire after 1 hour** of inactivity.

---

## Changelog

### Database Changes

#### 1. `visit_id` column added to invoices table
The original invoices table only linked to appointments, which broke for walk-in patients
with no appointment. A `visit_id` column with a `UNIQUE` constraint was added to `invoices`,
giving every invoice a direct, duplicate-proof link to its visit.

Files changed:
- `db_setup/clinic_db.sql` — added `visit_id` column, unique key, and FK to `medical_visits`
- `db_setup/add_visit_id_to_invoices.sql` — migration script for existing databases

#### 2. Legacy invoice backfill
After adding `visit_id`, all pre-migration invoices had `visit_id = NULL`, causing visits
with existing invoices to still show "Generate Invoice". Each invoice was matched to its
visit by `appointment_id` or by date/patient and updated with the correct `visit_id`.
Unmatched orphan duplicates were left as NULL.

Files changed:
- `db_setup/add_visit_id_to_invoices.sql` — backfill UPDATE statements matching invoices to visits

#### 3. test_data.sql invoices INSERT fixed for updated schema
After the `visit_id` column was added to the `invoices` table, the `test_data.sql` INSERT
statement still used positional column values without naming the columns. This caused values
to land in the wrong columns — `visit_id` received the `appointment_id` value and
`appointment_id` received the `invoice_date` value — breaking invoice lookups and the
LEFT JOIN in the appointments query. The INSERT was updated to use explicit column names.

Files changed:
- `db_setup/test_data.sql` — changed `INSERT INTO invoices VALUES` to `INSERT INTO invoices (invoice_id, patient_id, visit_id, appointment_id, ...)` with explicit column names

---

### Billing & Invoicing

#### 4. Duplicate invoice prevention
The backend had no guard against creating two invoices for the same visit. `create_invoice()`
now requires `visit_id`, queries for an existing invoice before inserting, and returns
HTTP 409 if one is found. The database unique constraint acts as a second safety net for
race conditions.

Files changed:
- `backend/routes/billing.py` — added pre-insert duplicate check and `IntegrityError` catch

#### 5. Invoice status on the Medical Visits tab
The visits tab showed a "Generate Invoice" button on every row regardless of whether an
invoice existed. The visits query now LEFT JOINs invoices on `visit_id`, returning
`has_invoice` and `linked_invoice_id` per visit. The button now shows "View Invoice",
"Generate Invoice", or "Pending Invoice" based on status and role.

Files changed:
- `backend/routes/medical_visits.py` — added LEFT JOIN on `visit_id` to visits query
- `frontend/patients/profile.js` — added `renderVisitInvoiceCell()` function

#### 6. No page redirect after invoice creation
After creating an invoice, the page redirected away, and returning via the back button
showed stale cached data with the wrong button state. `submitInvoice()` now stays on the
page and calls `loadVisits()` + `loadBilling()` in place. A toast confirms success.

Files changed:
- `frontend/patients/profile.js` — removed redirect from `submitInvoice()`, added in-place tab reload

#### 7. Cache invalidation after invoice creation
Only the `invoices` cache was cleared after creation, leaving `medical-visits` and `patients`
caches stale for up to 30 seconds. Three caches are now invalidated together so all parts
of the UI reflect the new state immediately.

Files changed:
- `backend/routes/billing.py` — added `cache_invalidate('medical-visits:{patient_id}')` and `cache_invalidate('patients:')`

#### 8. Billing status on the patient list
There was no way to see which patients needed an invoice without opening each profile
individually. The patients query now returns `pending_invoice_count` and `invoiced_count`
via conditional aggregation. The list shows an amber "Needs Invoice" or green "Invoiced"
button for admin/receptionist.

Files changed:
- `backend/routes/patients.py` — added `pending_invoice_count` and `invoiced_count` to patients query
- `frontend/patients/list.js` — updated `renderTable()` to show billing status buttons

#### 9. Billing actions on the appointments page
After a doctor completed a consultation, admin/receptionist had to navigate away from
appointments, find the patient, and locate the visit manually. The appointment view modal
now shows "Generate Invoice" or "View Invoice" for completed appointments.

Files changed:
- `frontend/appointments/appointments.js` — updated `openViewModal()` to render billing buttons for admin/receptionist

---

### Appointments

#### 10. Upcoming appointments filter changed from NOW() to CURDATE()
The dashboard was excluding same-day appointments that had already passed the current hour.
For example, an appointment at 09:00 would disappear from the upcoming list by 09:01 even
though the patient had not yet been seen. The filter was changed so all appointments on
today's date remain visible regardless of the current time.

Files changed:
- `backend/routes/appointments.py` — changed `>= NOW()` to `DATE(appointment_datetime) >= CURDATE()` in `get_upcoming_appointments()`

#### 11. Auto-expiry of past scheduled appointments
Appointments whose date passed without being completed, cancelled, or marked as no-show
remained in `Scheduled` status indefinitely. This caused the upcoming count on the dashboard
to be inaccurate — stale scheduled appointments from past dates were silently excluded by
the date filter but never cleaned up. The upcoming endpoint now runs an UPDATE before the
SELECT to auto-mark any `Scheduled` appointment with a past date as `No-show`, then
invalidates the appointments cache so the change is immediately reflected across the UI.

Files changed:
- `backend/routes/appointments.py` — added auto-expiry UPDATE in `get_upcoming_appointments()` before the SELECT, followed by `cache_invalidate('appointments')`

---

### UI & Navigation

#### 12. Auto-open Medical Visits tab via URL hash
Navigation from the patient list and appointments page needed to land on the Medical Visits
tab automatically. Profile pages now check `window.location.hash === '#billing'` on load
and click the tab programmatically.

Files changed:
- `frontend/patients/profile.js` — added hash check and auto-tab click on page load
- `frontend/patients/list.js` — `goToInvoice()` navigates with `#billing` hash
- `frontend/appointments/appointments.js` — "Generate Invoice" button navigates with `#billing` hash

#### 13. Edit button removed from patient list
The Edit button on the patient list showed a "coming soon" toast and served no purpose.
Patient editing exists on the profile page. The button was removed to reduce clutter.

Files changed:
- `frontend/patients/list.js` — removed Edit button from `renderTable()`

#### 14. Favicon added to all pages
Every page load triggered a `404` error in the browser console because no favicon existed.
An inline SVG data URI favicon (blue square, "HB" initials) was added to all 11 HTML files,
eliminating the 404 with no extra files needed.

Files changed:
- All 11 HTML files — added `<link rel="icon">` with inline SVG data URI to each `<head>`

---

### Reports

#### 15. No-show rate added to operational report
The operational report summary cards showed Completion Rate, Cancellation Rate, and
Scheduled Rate but had no visibility into how many appointments resulted in a no-show.
Since no-shows are a key operational metric for a clinic — indicating patients who booked
but did not attend — the No-show Rate was added as a dedicated summary card. The backend
calculates it the same way as the other rates, and the frontend renders it between
Cancellation Rate and Scheduled Rate.

Files changed:
- `backend/routes/reports.py` — added `no_show_rate` calculation and included it in the operational report response
- `frontend/reports/reports.js` — added `no_show_rate` to `reportData` parsing and added `No-show Rate` card in `renderSummaryCards()`
