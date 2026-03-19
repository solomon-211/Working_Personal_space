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

### 1 — Start MySQL

Make sure MySQL is running, then open a terminal and connect:
```bash
mysql -u root -p
```

### 2 — Set Up the Database

Inside the MySQL prompt, run in this order:
```sql
SOURCE db_setup/clinic_db.sql;
SOURCE db_setup/add_unique_invoice_appointment_index.sql;
SOURCE db_setup/add_visit_id_to_invoices.sql;
SOURCE db_setup/test_data.sql;
```
> Skip `test_data.sql` if you want a clean empty database.

### 3 — Install Python Dependencies

```bash
cd HealthHubBridge_Project/backend
pip install -r requirements.txt
```

### 4 — Configure the Backend

Create a `.env` file inside `backend/`:
```env
DB_PASSWORD=your_mysql_root_password
SECRET_KEY=any-random-string
```

### 5 — Start the Backend

```bash
cd HealthHubBridge_Project/backend
python app.py
```
API runs at `http://localhost:5000`. Keep this terminal open.

### 6 — Serve the Frontend

Open `HealthHubBridge_Project/frontend/` in VS Code, right-click `index.html`, and select **Open with Live Server**. Must run on port **5500**.

### 7 — Log In

Go to `http://127.0.0.1:5500` and use a test account:

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

## Key Business Rules

- **One visit = one invoice.** Enforced by a `UNIQUE` constraint on `invoices.visit_id` and a 409 check in the API.
- **Invoice creation requires a completed consultation.** The doctor must submit the consultation form first.
- **Only admin/receptionist can create invoices.** Doctors can view but not bill.
- **Payments cannot exceed the remaining balance.**
- **Non-cash payments require a reference** (card last 4 digits, mobile transaction ID, or insurance claim number).
- **Sessions expire after 1 hour** of inactivity.

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
| GET | `/api/services` | List billable services |
| GET/POST | `/api/invoices` | List / create invoices |
| GET | `/api/invoices/:id` | Get invoice detail |
| POST | `/api/payments` | Record payment |
