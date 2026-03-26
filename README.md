# HealthHub Bridge — Community Clinic Management System

## Requirements

- Python 3.12+
- MySQL 8.0 (service name: MySQL80)
- VS Code with Live Server extension

---

## 1. Start MySQL

Open Command Prompt as Administrator and run:

```cmd
net start MySQL80
```

---

## 2. Set up the database

Open MySQL Workbench or MySQL command line and run:

```sql
source database/clinic_db.sql
source database/test_data.sql
```

---

## 3. Configure environment

Create a file called `.env` inside the `backend/` folder with the following:

```env
SECRET_KEY=healthbridge-dev-secret-key
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=healthbridge_db
```

---

## 4. Install Python dependencies

```bash
cd backend
pip install flask flask-cors mysql-connector-python python-dotenv requests
```

---

## 5. Start the backend

```bash
cd backend
python app.py
```

Flask runs on `http://localhost:5000`.

---

## 6. Start the frontend

Open the `frontend/` folder with VS Code Live Server.
The app runs on `http://127.0.0.1:5500`.

---

## Test Accounts

| Username | Password | Role |
|---|---|---|
| `admin.juba` | `admin123` | Admin |
| `amina.lado` | `amina123` | Receptionist |
| `john.ladu` | `john123` | Receptionist |
| `j.lual` | `doctor123` | Doctor |
| `g.akuei` | `doctor123` | Doctor |
