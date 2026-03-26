# HealthHub Bridge — Community Clinic Management System (CCMS)

A web-based clinic management system built for community health facilities in South Sudan.
It manages patients, doctors, appointments, medical visits, billing, and reporting through
a Flask REST API backend and a plain HTML/CSS/JavaScript frontend.

---

## Project Structure

```
HealthHubBridge_Project/
├── backend/
│   ├── app.py                  # Flask application entry point
│   ├── config.py               # DB config and get_db_connection()
│   ├── cache.py                # In-memory TTL cache
│   ├── requirements.txt        # Python dependencies
│   ├── .env                    # Environment variables (not committed)
│   └── routes/
│       ├── auth.py             # Login, logout, session decorators
│       ├── patients.py         # Patient CRUD
│       ├── doctors.py          # Doctors and schedules
│       ├── appointments.py     # Booking and status updates
│       ├── medical_visits.py   # Visits, diagnoses, prescriptions
│       ├── billing.py          # Invoices, payments, Paystack
│       └── reports.py          # Dashboard stats, analytics, reports
├── frontend/
│   ├── assets/
│   │   ├── css/style.css       # Global styles
│   │   └── js/utils.js         # Shared utilities (apiFetch, idbCache, helpers)
│   ├── auth/                   # Login page
│   ├── dashboard/              # Admin/doctor dashboard
│   ├── patients/               # Patient list, profile, registration
│   ├── doctors/                # Doctor directory and schedules
│   ├── appointments/           # Appointment booking and management
│   ├── billing/                # Invoices and payments
│   └── reports/                # Financial, clinical, operational reports
└── db_setup/
    ├── clinic_db.sql           # Database schema
    └── test_data.sql           # Seed data for testing
```

---

## Prerequisites

- Python 3.12+
- MySQL 8.0 (service name: MySQL80)
- A browser with a local server (e.g. VS Code Live Server on port 5500)

---

## Setup

### 1. Database

```sql
-- Run in MySQL Workbench or terminal
source db_setup/clinic_db.sql
source db_setup/test_data.sql
```

### 2. Backend environment

Create `backend/.env`:

```env
SECRET_KEY=healthbridge-dev-secret-key
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=healthbridge_db
```

### 3. Install dependencies

```bash
cd backend
pip install flask flask-cors mysql-connector-python python-dotenv requests
```

### 4. Run the backend

```bash
cd backend
python app.py
```

Flask runs on `http://localhost:5000`.

### 5. Run the frontend

Open `frontend/` with VS Code Live Server or any static file server on port 5500.

---

## Test Accounts

| Username | Password | Role |
|---|---|---|
| `admin.juba` | `admin123` | Admin |
| `amina.lado` | `amina123` | Receptionist |
| `john.ladu` | `john123` | Receptionist |
| `j.lual` | `doctor123` | Doctor |
| `g.akuei` | `doctor123` | Doctor |

Passwords are stored as SHA-256 hashes in the `users` table.

---

## API Reference

All routes are prefixed with `/api`. Protected routes require an active session cookie.

### Authentication — `/api/auth`

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/api/auth/login` | Public | Login with username and password |
| POST | `/api/auth/logout` | Any | Clear session and log out |

### Patients — `/api/patients`

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/api/patients` | All | List all patients. Supports `?search=` query |
| GET | `/api/patients/:id` | All | Get a single patient by ID |
| POST | `/api/patients` | All | Register a new patient |
| PATCH | `/api/patients/:id` | All | Update allowed fields (phone, email, blood_type, etc.) |

The list endpoint returns two extra fields per patient via conditional aggregation:
- `pending_invoice_count` — visits with no invoice yet
- `invoiced_count` — visits that already have an invoice

### Doctors — `/api/doctors`

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/api/doctors` | All | List all active doctors |
| GET | `/api/doctor-schedules` | All | All doctor weekly schedules |
| GET | `/api/doctor-schedules/:doctor_id?date=` | All | Available slots for a doctor on a date |

`start_time` values from MySQL `TIME` columns are serialized to strings to avoid
`timedelta` JSON serialization errors.

### Appointments — `/api/appointments`

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/api/appointments` | All | List appointments. Supports `?doctor_id=`, `?status=`, `?date=`, `?patient_id=` |
| GET | `/api/appointments/upcoming` | All | All future Scheduled appointments |
| GET | `/api/appointments/week-summary` | All | 7-day appointment counts grouped by status |
| POST | `/api/appointments` | All | Book a new appointment |
| PATCH | `/api/appointments/:id` | All | Update status (Completed / Cancelled / No-show) |

Booking validation:
- Rejects past datetimes
- Checks doctor works on that day of week
- Blocks double-booking within 30 minutes

Status transitions are enforced — only `Scheduled → Completed / Cancelled / No-show` is allowed.

### Medical Visits — `/api/medical-visits`

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/api/medical-visits/:patient_id` | All | All visits for a patient with diagnoses attached |
| POST | `/api/medical-visits` | Admin, Doctor | Record a new visit |
| GET | `/api/diagnoses/:visit_id` | All | Get diagnoses for a visit |
| POST | `/api/diagnoses` | Admin, Doctor | Add a diagnosis to a visit |
| GET | `/api/prescriptions/:patient_id` | All | All prescriptions for a patient |
| POST | `/api/prescriptions` | Admin, Doctor | Add a prescription to a visit |

The visits endpoint LEFT JOINs the `invoices` table so each visit row includes:
- `has_invoice` (0 or 1)
- `linked_invoice_id`

### Billing — `/api/invoices`, `/api/payments`, `/api/paystack`

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/api/invoices` | All | List invoices. Supports `?patient_id=`, `?status=` |
| GET | `/api/invoices/:id` | All | Single invoice with line items |
| POST | `/api/invoices` | Admin, Receptionist | Create invoice with line items |
| POST | `/api/payments` | Admin, Receptionist | Record a payment against an invoice |
| POST | `/api/paystack/initialize` | Admin, Receptionist | Initialize a Paystack transaction (returns access_code) |
| GET | `/api/paystack/verify/:reference` | Admin, Receptionist | Verify a Paystack transaction before saving to DB |

Payment status is automatically recalculated after each payment:
- `total_paid >= amount_due` → `Paid`
- `total_paid > 0` → `Partial`
- `total_paid == 0` → `Unpaid`

### Reports — `/api/reports`, `/api/dashboard`, `/api/analytics`

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/api/dashboard/stats` | All | Today's patient count, appointments, revenue, unpaid invoices |
| GET | `/api/analytics/weekly` | All | 7-day appointments and revenue trend |
| GET | `/api/analytics/snapshots` | All | Pre-aggregated daily snapshots (up to 90 days) |
| GET | `/api/reports/financial?from=&to=` | Admin | Revenue, payment methods, outstanding balances |
| GET | `/api/reports/clinical?from=&to=` | Admin, Doctor | Top diagnoses and visit volume |
| GET | `/api/reports/operational?from=&to=` | Admin | Appointment completion, cancellation, no-show, scheduled rates |

---

## Frontend Pages

| Page | Path | Roles |
|---|---|---|
| Login | `/auth/login.html` | Public |
| Dashboard | `/dashboard/index.html` | All |
| Patient List | `/patients/list.html` | Admin, Receptionist, Doctor |
| Patient Profile | `/patients/profile.html?id=` | All |
| Register Patient | `/patients/register.html` | Admin, Receptionist |
| Doctors | `/doctors/index.html` | Admin |
| Appointments | `/appointments/index.html` | Admin, Receptionist, Doctor |
| Billing | `/billing/index.html` | Admin, Receptionist |
| Invoice Detail | `/billing/invoice.html?id=` | Admin, Receptionist |
| Reports | `/reports/index.html` | Admin, Doctor |

---

## Key Features

### Authentication and Sessions
- SHA-256 password hashing
- Server-side Flask sessions with 1-hour auto-expiry
- `login_required` and `role_required` decorators on all protected routes
- Frontend `authGuard()` redirects unauthenticated users to login

### Role-Based Access Control
Three roles with different permissions:

| Feature | Admin | Receptionist | Doctor |
|---|---|---|---|
| View patients | ✅ | ✅ | ✅ |
| Register patients | ✅ | ✅ | ❌ |
| Manage doctors | ✅ | ❌ | ❌ |
| Create invoices | ✅ | ✅ | ❌ |
| Record payments | ✅ | ✅ | ❌ |
| View reports | ✅ | ❌ | ✅ (clinical only) |
| Add diagnoses | ✅ | ❌ | ✅ |

### In-Memory Backend Cache
`cache.py` provides a simple TTL key-value store used across all GET endpoints.
Cache is invalidated on every POST/PATCH so stale data is never served.

| Cache key | TTL |
|---|---|
| `patients:*` | 30s |
| `doctors:active` | 5 min |
| `doctor-schedules:*` | 5 min |
| `appointments:*` | 30s |
| `invoices:*` | 30s |
| `services:all` | 10 min |
| `dashboard:stats:*` | 60s |
| `analytics:weekly:*` | 5 min |

### Frontend IndexedDB Cache (idbCache)
`utils.js` includes an `idbCache` wrapper around the browser's IndexedDB API.
It acts as a fallback cache — not a primary cache.

Flow:
1. `apiFetch()` calls the backend normally
2. On success — response is silently written to IndexedDB keyed by endpoint URL
3. On failure — `idbCache.get(endpoint)` is checked
4. If found — a "Showing cached data" warning toast is shown and stale data is returned
5. If not found — error toast is shown and the error is thrown

Only GET requests are cached. POST/PATCH are never stored or served from cache.
No TTL — cache holds the last known good response until overwritten by a new successful fetch.

This allows clinic staff to continue viewing patient lists, appointments, and billing
information during server downtime — critical given unreliable power supply in South Sudan.

### Patient List Invoice Indicators
The patient list shows invoice status buttons for admin and receptionist roles:
- Amber **"Needs Invoice"** button — patient has visits with no invoice yet
- Green **"Invoiced"** button — all visits have invoices
- Both buttons navigate to the patient's profile billing tab

Counts are calculated server-side using conditional aggregation in the SQL query —
no extra API calls needed.

### Patient Profile — Generate / View Invoice
Each visit row in the Medical Visits tab shows an invoice action cell:
- **"Generate Invoice"** — visit has no invoice, user is admin or receptionist
- **"View Invoice"** — links directly to the invoice detail page
- **"Pending Invoice"** — visit has no invoice, user is a doctor (read-only)

After invoice creation, `loadVisits()` and `loadBilling()` are called in-place —
the button updates to "View Invoice" without a page reload.

### Paystack Payment Integration
Card and Mobile Money payments go through Paystack's secure hosted popup.
Cash and Insurance payments are recorded manually.

**Card / Mobile flow:**
1. Staff enters amount and patient email
2. Frontend calls `POST /api/paystack/initialize` — Flask sends the secret key to Paystack server-side and returns an `access_code`
3. Paystack popup opens — card or mobile details are entered inside Paystack's secure UI (never on your server)
4. On payment success, Paystack calls the `callback` with a `reference`
5. Frontend calls `GET /api/paystack/verify/:reference` — Flask confirms with Paystack's API that money actually moved
6. Only after verification passes, `POST /api/payments` saves the payment to the database with the Paystack reference, card type, and last 4 digits

The Paystack secret key (`sk_test_...`) lives only in the Flask backend and is never
exposed to the browser. The public key (`pk_test_...`) is used only to open the popup.

**Cash flow:** Staff enters amount and optional receipt reference → saved directly to DB.

**Insurance flow:** Staff enters insurer name, claim number or reference, and optional
authorization code → combined into a single reference string → saved to DB.
At least one of reference number or claim number is required.

### Operational Report Rates
The operational report calculates four rates from appointment status counts:
- Completion Rate — `Completed / total`
- Cancellation Rate — `Cancelled / total`
- No-show Rate — `No-show / total`
- Scheduled Rate — `Scheduled / total`

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | `healthbridge-dev-secret-key` | Flask session signing key |
| `DB_HOST` | `localhost` | MySQL host |
| `DB_PORT` | `3306` | MySQL port |
| `DB_USER` | `root` | MySQL username |
| `DB_PASSWORD` | _(empty)_ | MySQL password |
| `DB_NAME` | `healthbridge_db` | MySQL database name |
| `SESSION_LIFETIME` | `3600` | Session expiry in seconds |
| `CACHE_TTL` | `30` | Default cache TTL in seconds |

---

## Database Schema Summary

| Table | Description |
|---|---|
| `users` | Login accounts with role (admin, doctor, receptionist) |
| `patients` | Patient demographics and medical info |
| `doctors` | Clinician profiles and active status |
| `doctor_schedule` | Weekly shift slots per doctor |
| `appointments` | Scheduled visits between patient and doctor |
| `medical_visits` | Actual visit records linked to appointments |
| `diagnoses` | Diagnoses attached to a visit |
| `prescriptions` | Medications prescribed during a visit |
| `services` | Billable service catalogue with unit prices |
| `invoices` | Invoice headers with payment status |
| `invoice_items` | Line items linking invoices to services |
| `payments` | Payment records against invoices |
| `analytics_snapshots` | Pre-aggregated daily metrics |
| `reports` | Saved report metadata |

---

## Dependencies

### Backend
| Package | Version | Purpose |
|---|---|---|
| `flask` | 3.0.3 | Web framework |
| `flask-cors` | 4.0.1 | Cross-origin requests from frontend |
| `mysql-connector-python` | 8.3.0 | MySQL database driver |
| `python-dotenv` | latest | Load `.env` file |
| `requests` | latest | HTTP calls to Paystack API |

### Frontend
| Library | Source | Purpose |
|---|---|---|
| Paystack Inline JS | `https://js.paystack.co/v1/inline.js` | Payment popup |

No other frontend frameworks or build tools — plain HTML, CSS, and JavaScript only.
