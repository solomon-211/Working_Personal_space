# HealthHub Bridge — Clinic & Care Management System

A web-based clinic management system built with Flask, MySQL, and vanilla HTML/CSS/JS. Covers patient registration, appointments, doctor consultations, medical visits, prescriptions, and billing.

---

## Prerequisites

| Tool | Version |
|---|---|
| Python | 3.10+ |
| MySQL | 8.0+ |
| VS Code + Live Server extension | Any |

---

## Running the Project

**1 — Start MySQL** and connect: `mysql -u root -p`

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
cd HealthHubBridge_Project/backend
pip install -r requirements.txt
```

**4 — Configure backend** — create `backend/.env`:
```env
DB_PASSWORD=your_mysql_root_password
SECRET_KEY=any-random-string
```

**5 — Start the backend:** `python app.py` — API runs at `http://localhost:5000`

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
| GET | `/api/doctors` | List doctors |
| GET/POST | `/api/appointments` | List / book appointments |
| PATCH | `/api/appointments/:id` | Update appointment status |
| GET/POST | `/api/medical-visits/:patient_id` | Get / create visit records |
| POST | `/api/diagnoses` | Add diagnosis to visit |
| GET/POST | `/api/prescriptions/:patient_id` | Get / add prescriptions |
| GET/POST | `/api/invoices` | List / create invoices |
| GET | `/api/invoices/:id` | Get invoice with payments |
| POST | `/api/payments` | Record payment |

---

## Changes Made

### 1. `visit_id` column added to invoices table
The original invoices table only linked to appointments, which broke for walk-in patients with no appointment. A `visit_id` column with a `UNIQUE` constraint was added to `invoices`, giving every invoice a direct, duplicate-proof link to its visit. A migration script (`add_visit_id_to_invoices.sql`) was created for existing databases.

### 2. Duplicate invoice prevention
The backend had no guard against creating two invoices for the same visit. `create_invoice()` now requires `visit_id`, queries for an existing invoice before inserting, and returns HTTP 409 if one is found. The database unique constraint acts as a second safety net for race conditions.

### 3. Invoice status on the Medical Visits tab
The visits tab showed a "Generate Invoice" button on every row regardless of whether an invoice existed. The visits query now LEFT JOINs invoices on `visit_id`, returning `has_invoice` and `linked_invoice_id` per visit. The button now shows "View Invoice", "Generate Invoice", or "Pending Invoice" based on status and role.

### 4. No page redirect after invoice creation
After creating an invoice, the page redirected away, and returning via the back button showed stale cached data with the wrong button state. `submitInvoice()` now stays on the page, invalidates the cache, and calls `loadVisits()` + `loadBilling()` in place. A toast confirms success.

### 5. Cache invalidation after invoice creation
Only the `invoices` cache was cleared after creation, leaving `medical-visits` and `patients` caches stale for up to 30 seconds. Three caches are now invalidated together: `invoices`, `medical-visits:{patient_id}`, and `patients:`, so all parts of the UI reflect the new state immediately.

### 6. Billing status on the patient list
There was no way to see which patients needed an invoice without opening each profile individually. The patients query now returns `pending_invoice_count` and `invoiced_count` via conditional aggregation. The list shows an amber "Needs Invoice" or green "Invoiced" button for admin/receptionist, linking directly to the patient's visits tab.

### 7. Billing actions on the appointments page
After a doctor completed a consultation, admin/receptionist had to navigate away from appointments, find the patient, and locate the visit manually. The appointment view modal now shows "Generate Invoice" or "View Invoice" for completed appointments, using the `has_invoice` field already returned by the appointments API.

### 8. Auto-open Medical Visits tab via URL hash
Navigation from the patient list and appointments page needed to land on the Medical Visits tab automatically. Profile pages now check `window.location.hash === '#billing'` on load and click the tab programmatically. All billing navigation links append `#billing` to the URL.

### 9. Edit button removed from patient list
The Edit button on the patient list showed a "coming soon" toast and served no purpose. Patient editing exists on the profile page. The button was removed to reduce clutter — the Actions column now contains only meaningful actions.

### 10. Favicon added to all pages
Every page load triggered a `404` error in the browser console because no favicon existed. An inline SVG data URI favicon (blue square, "HB" initials) was added to all 11 HTML files, eliminating the 404 with no extra files needed.

### 11. Legacy invoice backfill
After adding `visit_id`, all pre-migration invoices had `visit_id = NULL`, causing visits with existing invoices to still show "Generate Invoice". Each invoice was matched to its visit by `appointment_id` or by date/patient and updated with the correct `visit_id`. Unmatched orphan duplicates were left as NULL and do not affect new invoice creation.

---

## Key Business Rules

- **One visit = one invoice** — enforced by DB unique constraint and API 409 check.
- **Invoice requires a completed consultation** — doctor must submit the consultation form first.
- **Only admin/receptionist can create invoices** — doctors can view but not bill.
- **Payments cannot exceed the remaining balance.**
- **Non-cash payments require a reference** — card last 4, mobile transaction ID, or insurance claim number.
- **Sessions expire after 1 hour** of inactivity.
