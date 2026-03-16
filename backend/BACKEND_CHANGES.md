# Backend Changes — Frontend Integration Fixes

This document records every backend change made to align the Flask API with the
calls that the frontend JavaScript files actually make. All changes are additions
or small extensions — no existing logic was removed or broken.

---

## Baseline Comparison (Original Backend vs Current Backend)

This section summarizes the exact backend differences relative to the earlier original backend codes.

### App Runtime and Serving Differences

#### app.py now serves frontend files directly

- **Earlier baseline:** API blueprints and error handlers only.
- **Current:** Added `/` and `/<path:filename>` handlers so frontend routes like
  `/dashboard/index.html`, `/auth/login.html`, and `/assets/...` resolve from Flask.

#### CORS now supports credentials

- **Earlier baseline:** `CORS(app)`.
- **Current:** `CORS(app, supports_credentials=True)` to support session-cookie auth
  with `credentials: 'include'` requests from frontend JavaScript.

#### Session cookie behavior is explicitly configured

- **Earlier baseline:** No explicit cookie flags in app runtime.
- **Current:** `SESSION_COOKIE_SAMESITE`, `SESSION_COOKIE_SECURE`, and
  `SESSION_COOKIE_HTTPONLY` are set for reliable local development behavior.

#### Environment loading is more robust

- **Earlier baseline:** relied on process environment values.
- **Current:** environment loading is handled safely, and backend config can still
  read `.env` values even if optional dotenv import behavior varies.

### API Route Differences

#### Existing route behavior was extended

- `GET /api/appointments` now supports `patient_id` filtering.
- `GET /api/appointments/today` now returns true upcoming scheduled appointments
  (excludes completed and past-time entries).

#### New compatibility endpoints were added

- `GET /api/patients/<patient_id>/prescriptions`
- `GET /api/visits/<visit_id>/summary`
- `POST /api/consultations`
- `POST /api/invoices/from-visit`

### Why These Differences Matter

These deltas close the mismatch between frontend calls and backend capabilities.
Without them, the UI would encounter 404 routes, incorrect datasets (for example
unfiltered appointments), session/cookie login issues, and invoice/consultation
flows that could not complete from patient and appointment screens.

---

## 1. `routes/appointments.py` — Added `patient_id` filter to `GET /appointments`

### What changed in appointments

The `GET /appointments` route previously accepted `doctor_id`, `status`, and `date`
as optional query-string filters. A `patient_id` filter was added alongside them.

```text
GET /api/appointments?patient_id=<id>
```

The cache key was also updated to include `patient_id` so that filtered results are
cached independently from unfiltered ones.

### Why it is needed for appointments UI

`patients/profile.js` loads the appointment history tab for the currently viewed
patient with:

```js
const data = await apiFetch(`/api/appointments?patient_id=${patientId}`);
```

Without the `patient_id` filter the endpoint returned **every appointment in the
system** instead of only the ones that belong to that patient. The appointment tab
would either show wrong data or process far more rows than necessary.

---

## 2. `routes/patients.py` — New route `GET /patients/<id>/prescriptions`

### What changed in patients

A new route alias was added to `patients.py`:

```text
GET /api/patients/<patient_id>/prescriptions
```

It runs the same query as the existing `/prescriptions/<patient_id>` route in
`medical_visits.py` and returns the same JSON shape
(`{ "prescriptions": [...] }`).

### Why it is needed for patient profile prescriptions

`patients/profile.js` fetches the prescriptions tab using the URL:

```js
const data = await apiFetch(`/api/patients/${patientId}/prescriptions`);
```

The only prescription endpoint that existed was `/api/prescriptions/<patient_id>` —
a completely different URL structure. The profile page would receive a **404 Not
Found** every time it tried to load the prescriptions tab. Adding the alias fixes
this without changing the existing route or the frontend.

---

## 3. `routes/medical_visits.py` — New route `GET /visits/<visit_id>/summary`

### What changed in medical visits summary

A new route was added:

```text
GET /api/visits/<visit_id>/summary
```

It returns a single visit record joined with its doctor name, and with its
`diagnoses` (list of description strings) and `prescriptions`
(`drug_name`, `dosage`, `duration`) embedded in the response:

```json
{
  "visit": {
    "visit_id": 5,
    "visit_date": "2025-06-10",
    "notes": "...",
    "doctor_name": "Dr. Jane Smith",
    "diagnoses": ["Acute pharyngitis"],
    "prescriptions": [{ "drug_name": "Amoxicillin", "dosage": "500mg", "duration": "7 days" }]
  }
}
```

### Why it is needed for invoice modal prefill

`patients/profile.js` opens an invoice-creation modal from the visit history list.
Before populating the modal it calls:

```js
const [visitRes, svcRes] = await Promise.all([
  apiFetch(`/api/visits/${visitId}/summary`),
  apiFetch('/api/services')
]);
```

It uses the returned diagnoses and prescriptions to pre-fill the modal's item rows
so that the receptionist does not have to type out drug names manually. Without
this route the modal could never load visit details and would silently fail.

---

## 4. `routes/medical_visits.py` — New route `POST /consultations`

### What changed in consultations

A new route was added:

```text
POST /api/consultations
```

Expected request body:

```json
{
  "patient_id": 1,
  "doctor_id": 2,
  "appointment_id": 5,
  "visit_date": "2025-06-10",
  "notes": "Patient presents with sore throat.",
  "diagnoses": ["Acute pharyngitis"],
  "prescriptions": [
    { "drug_name": "Amoxicillin", "dosage": "500mg", "duration": "7 days" }
  ]
}
```

The endpoint runs a single database transaction that:

1. Inserts a row into `medical_visits`.
2. Bulk-inserts any diagnoses into `diagnoses`.
3. Bulk-inserts any prescriptions into `prescriptions`.
4. Updates the linked appointment's `status` to `'Completed'`.

It then invalidates the visit and appointment caches so subsequent reads are fresh.

Access is restricted to users with the `doctor` or `admin` role.

### Why it is needed for consultation save flow

`appointments/appointments.js` contains a **Record Consultation** modal that lets
the doctor enter visit notes, diagnoses, and prescriptions directly from the
appointments page. On submit it posts everything to:

```js
await apiFetch('/api/consultations', { method: 'POST', body: JSON.stringify({...}) });
```

Without this route the endpoint did not exist at all — the call would return a
**404** and the consultation modal would never successfully save. Doctors would
have no way to record visit outcomes from the appointments view.

The single-transaction design is important: it guarantees that either the full
consultation (visit + diagnoses + prescriptions + appointment status update) is
saved together or nothing is saved, preventing partial records in the database.

---

## 5. `routes/billing.py` — New route `POST /invoices/from-visit`

### What changed in billing from visit

A new route was added:

```text
POST /api/invoices/from-visit
```

Expected request body:

```json
{
  "patient_id": 1,
  "visit_id": 5,
  "discount": 500,
  "items": [
    { "service_name": "Amoxicillin — 500mg (7 days)", "quantity": 1, "unit_price": 350.00 },
    { "service_name": "Consultation Fee",              "quantity": 1, "unit_price": 1500.00 }
  ]
}
```

Items use **free-text names and explicit prices** rather than `service_id` lookups.
If a service name already exists in the `services` catalogue it is reused;
otherwise a new row is inserted automatically (with `category = 'Other'`) so that
the `invoice_items.service_id NOT NULL` foreign key constraint is always satisfied.

It then inserts the invoice header into `invoices` and the line items into
`invoice_items`, and invalidates the invoices cache.

Access is restricted to `admin` and `receptionist` roles.

### Why it is needed for profile billing flow

The existing `POST /invoices` route requires items keyed by `service_id` — the
caller must know the exact catalogue ID for every line item. This works fine for
the billing module where the receptionist picks services from a dropdown.

However, the invoice modal on the **patient profile page** works differently: it
pre-fills rows from the visit's prescriptions and lets the user type any item
name with a price (e.g. a drug that is not in the catalogue). `profile.js` submits
with:

```js
const res = await apiFetch('/api/invoices/from-visit', {
  method: 'POST',
  body: JSON.stringify({ patient_id, visit_id, discount, items })
});
```

where `items` contains `service_name`, `quantity`, and `unit_price` — **no
`service_id`**. Without this route every invoice created from the patient profile
would return a **404**, making it impossible to bill a patient directly after a
consultation.

---

## Summary Table

| Route | File | Frontend caller | Symptom without fix |
| --- | --- | --- | --- |
| `GET /api/appointments?patient_id=` | `appointments.py` | `profile.js` | All appointments returned instead of patient's |
| `GET /api/patients/<id>/prescriptions` | `patients.py` | `profile.js` | 404 — prescriptions tab always empty |
| `GET /api/visits/<visit_id>/summary` | `medical_visits.py` | `profile.js` | 404 — invoice modal could not load visit details |
| `POST /api/consultations` | `medical_visits.py` | `appointments.js` | 404 — consultation modal could never save |
| `POST /api/invoices/from-visit` | `billing.py` | `profile.js` | 404 — invoices could not be created from patient profile |
