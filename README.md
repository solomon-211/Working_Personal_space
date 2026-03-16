# HealthBridge — How to Run

## Prerequisites
- Python 3.10+
- MySQL 8+
- A static file server (e.g. VS Code Live Server)

---

## 1. Database

1. Open MySQL and create the database:
   ```sql
   CREATE DATABASE healthbridge_db;
   ```
2. Import the schema and test data:
   ```bash
   mysql -u root -p healthbridge_db < database/clinic_db.sql
   mysql -u root -p healthbridge_db < database/test_data.sql
   ```

---

## 2. Backend

```bash
cd backend
```

Copy the example env file and fill in your MySQL credentials:
```bash
copy .env.example .env
```

`.env` values to set:
```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=healthbridge_db
SECRET_KEY=any-random-string
```

Install dependencies and start the server:
```bash
pip install -r requirements.txt
python app.py
```

Backend runs at `http://localhost:5000`.

---

## 3. Frontend

Open the `frontend/` folder with **VS Code Live Server** (or any static server).

- Default Live Server address: `http://127.0.0.1:5500`
- Start at `frontend/auth/login.html`

---

## Test Credentials

| Username | Password | Role |
|---|---|---|
| `admin.juba` | `admin123` | Admin |
| `j.lual` | `doctor123` | Doctor |
| `g.akuei` | `doctor123` | Doctor |
| `amina.lado` | `recep123` | Receptionist |
| `john.ladu` | `recep123` | Receptionist |

---

## Known Fixes

### Consultation saving (400 Bad Request on `POST /api/medical-visits`)

**Root cause:** The `GET /api/appointments` query did not return `patient_id` or `doctor_id`, so the consultation form was sending `undefined` for both required fields.

**Fix applied:**
- `backend/routes/appointments.py` — added `a.patient_id, a.doctor_id` to the SELECT in both `get_appointments()` and `get_today_appointments()`
- `frontend/appointments/appointments.js` — `submitConsultation()` now reads `appt.patient_id` and `appt.doctor_id` directly from the appointment object, which are now present in the API response

### Appointment status guard (defensive transition validation)

**Root cause:** The PATCH route accepted any valid status string regardless of the appointment's current state, making it possible to update already-completed or cancelled appointments.

**Fix applied:**
- `backend/routes/appointments.py` — `update_appointment_status()` now fetches the current status before updating and enforces allowed transitions:
  - `Scheduled` → `Completed`, `Cancelled`, `No-show` (allowed)
  - `Completed`, `Cancelled`, `No-show` → anything (blocked with 409)
- Attempting an invalid transition returns a clear error: `Cannot update a Completed appointment`
