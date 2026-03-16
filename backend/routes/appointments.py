from flask import Blueprint, request, jsonify, session
from config import get_db_connection
from cache import cache_get, cache_set, cache_invalidate
from routes.auth import login_required
from datetime import datetime, date

appointments_bp = Blueprint('appointments', __name__)


# route to get appointments, with optional filters for doctor, status, or date
@appointments_bp.route('/appointments', methods=['GET'])
@login_required
def get_appointments():
    # Optional filters from query string: ?patient_id=1&doctor_id=1&status=Scheduled&date=2025-06-10
    patient_id = request.args.get('patient_id')
    doctor_id  = request.args.get('doctor_id')
    status     = request.args.get('status')
    appt_date  = request.args.get('date')

    cache_key = f'appointments:{patient_id}:{doctor_id}:{status}:{appt_date}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify({'appointments': cached, 'source': 'cache'}), 200

    # Build the query dynamically based on which filters were provided
    query  = """
        SELECT a.appointment_id, a.appointment_datetime, a.reason, a.status,
               p.first_name, p.last_name, p.clinic_number,
               d.full_name AS doctor_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.patient_id
        JOIN doctors  d ON a.doctor_id  = d.doctor_id
        WHERE 1=1
    """
    params = []

    if patient_id:
        query += " AND a.patient_id = %s"
        params.append(patient_id)
    if doctor_id:
        query += " AND a.doctor_id = %s"
        params.append(doctor_id)
    if status:
        query += " AND a.status = %s"
        params.append(status)
    if appt_date:
        query += " AND DATE(a.appointment_datetime) = %s"
        params.append(appt_date)

    query += " ORDER BY a.appointment_datetime"

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(query, params)
        appointments = cursor.fetchall()
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not retrieve appointments.', 'details': str(e)}), 503

    cache_set(cache_key, appointments)
    return jsonify({'appointments': appointments, 'source': 'db'}), 200


# route to get today's appointments for the dashboard
@appointments_bp.route('/appointments/today', methods=['GET'])
@login_required
def get_today_appointments():
    today = date.today().isoformat()
    cache_key = f'appointments:today:{today}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify({'appointments': cached, 'date': today, 'source': 'cache'}), 200

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT a.appointment_id, a.appointment_datetime, a.reason, a.status,
                   p.first_name, p.last_name, p.clinic_number,
                   d.full_name AS doctor_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.patient_id
            JOIN doctors  d ON a.doctor_id  = d.doctor_id
            WHERE DATE(a.appointment_datetime) = CURDATE()
              AND a.status = 'Scheduled'
              AND a.appointment_datetime >= NOW()
            ORDER BY a.appointment_datetime
        """)
        appointments = cursor.fetchall()
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not retrieve today\'s appointments.', 'details': str(e)}), 503

    cache_set(cache_key, appointments, ttl=60)  # cache for 60 s — dashboard refreshes often
    return jsonify({'appointments': appointments, 'date': today, 'source': 'db'}), 200


# route to get a summary of appointments for the past week (for admin dashboard)
@appointments_bp.route('/appointments/week-summary', methods=['GET'])
@login_required
def week_summary():
    cache_key = 'appointments:week-summary'
    cached = cache_get(cache_key)
    if cached:
        return jsonify({'summary': cached, 'source': 'cache'}), 200

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        # Count appointments grouped by day for the current 7-day window
        cursor.execute("""
            SELECT DATE(appointment_datetime) AS appt_date,
                   COUNT(*) AS total,
                   SUM(status = 'Completed')  AS completed,
                   SUM(status = 'Cancelled')  AS cancelled,
                   SUM(status = 'No-show')    AS no_show,
                   SUM(status = 'Scheduled')  AS scheduled
            FROM appointments
            WHERE appointment_datetime BETWEEN CURDATE() - INTERVAL 6 DAY
                                           AND CURDATE() + INTERVAL 1 DAY
            GROUP BY DATE(appointment_datetime)
            ORDER BY appt_date
        """)
        summary = cursor.fetchall()
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not retrieve week summary.', 'details': str(e)}), 503

    cache_set(cache_key, summary, ttl=120)
    return jsonify({'summary': summary, 'source': 'db'}), 200


# route to book a new appointment
@appointments_bp.route('/appointments', methods=['POST'])
@login_required
def book_appointment():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['patient_id', 'doctor_id', 'appointment_datetime']
    missing  = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    # Parse and validate the datetime string from the request
    try:
        appt_dt = datetime.strptime(data['appointment_datetime'], '%Y-%m-%d %H:%M:%S')
    except ValueError:
        return jsonify({'error': 'Invalid datetime format. Use: YYYY-MM-DD HH:MM:SS'}), 400

    # Appointments cannot be booked in the past
    if appt_dt < datetime.now():
        return jsonify({'error': 'Appointment datetime cannot be in the past'}), 400

    day_name = appt_dt.strftime('%a')   # e.g. 'Mon', 'Tue' — matches ENUM in doctor_schedule

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        # 1. Check the doctor actually works on this day
        cursor.execute("""
            SELECT schedule_id FROM doctor_schedule
            WHERE doctor_id = %s AND day_of_week = %s
        """, (data['doctor_id'], day_name))
        if not cursor.fetchone():
            conn.close()
            return jsonify({
                'error': f"Doctor is not available on {appt_dt.strftime('%A')}s. "
                          "Please choose a different day."
            }), 409

        # 2. Check for a double-booking on the same slot (within 30 minutes)
        cursor.execute("""
            SELECT appointment_id FROM appointments
            WHERE doctor_id = %s
              AND status    = 'Scheduled'
              AND ABS(TIMESTAMPDIFF(MINUTE, appointment_datetime, %s)) < 30
        """, (data['doctor_id'], data['appointment_datetime']))
        if cursor.fetchone():
            conn.close()
            return jsonify({'error': 'This time slot is already booked. Please choose another time.'}), 409

        # 3. All checks passed — insert the appointment
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO appointments (patient_id, doctor_id, appointment_datetime, reason, status)
            VALUES (%s, %s, %s, %s, 'Scheduled')
        """, (
            data['patient_id'],
            data['doctor_id'],
            data['appointment_datetime'],
            data.get('reason', '')
        ))
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Booking failed. Please try again.', 'details': str(e)}), 503

    cache_invalidate('appointments')
    return jsonify({'id': new_id, 'message': 'Appointment booked successfully'}), 201


# route to update appointment status (e.g. mark as Completed, Cancelled, No-show)
@appointments_bp.route('/appointments/<int:appointment_id>', methods=['PATCH'])
@login_required
def update_appointment_status(appointment_id):
    data = request.get_json()
    new_status = data.get('status') if data else None

    valid_statuses = ('Scheduled', 'Completed', 'Cancelled', 'No-show')
    if new_status not in valid_statuses:
        return jsonify({'error': f'Status must be one of: {", ".join(valid_statuses)}'}), 400

    try:
        conn   = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE appointments SET status = %s WHERE appointment_id = %s",
            (new_status, appointment_id)
        )
        conn.commit()
        affected = cursor.rowcount
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Update failed.', 'details': str(e)}), 503

    if affected == 0:
        return jsonify({'error': 'Appointment not found'}), 404

    cache_invalidate('appointments')
    return jsonify({'message': f'Appointment marked as {new_status}'}), 200