from flask import Blueprint, request, jsonify, session
from config import get_db_connection
from cache import cache_get, cache_set, cache_invalidate
from routes.auth import login_required
from datetime import datetime, date

appointments_bp = Blueprint('appointments', __name__)


@appointments_bp.route('/appointments', methods=['GET'])
@login_required
def get_appointments():
    """Return all appointments, with optional filters for doctor, patient, status, or date."""
    doctor_id  = request.args.get('doctor_id')
    patient_id = request.args.get('patient_id')
    status     = request.args.get('status')
    appt_date  = request.args.get('date')

    cache_key = f'appointments:{doctor_id}:{patient_id}:{status}:{appt_date}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify({'appointments': cached, 'source': 'cache'}), 200

    query = """
        SELECT a.appointment_id, a.patient_id, a.doctor_id,
               a.appointment_datetime, a.reason, a.status,
               p.first_name, p.last_name, p.clinic_number,
               d.full_name AS doctor_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.patient_id
        JOIN doctors  d ON a.doctor_id  = d.doctor_id
        WHERE 1=1
    """
    params = []

    if doctor_id:
        query += " AND a.doctor_id = %s"
        params.append(doctor_id)
    if patient_id:
        query += " AND a.patient_id = %s"
        params.append(patient_id)
    if status:
        query += " AND a.status = %s"
        params.append(status)
    if appt_date:
        query += " AND DATE(a.appointment_datetime) = %s"
        params.append(appt_date)

    query += " ORDER BY a.appointment_datetime"

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)
        cursor.execute(query, params)
        appointments = cursor.fetchall()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not retrieve appointments.', 'details': str(error)}), 503

    cache_set(cache_key, appointments)
    return jsonify({'appointments': appointments, 'source': 'db'}), 200


@appointments_bp.route('/appointments/today', methods=['GET'])
@login_required
def get_upcoming_appointments():
    """Return upcoming scheduled appointments for the dashboard (today and future, limit 10)."""
    today     = date.today().isoformat()
    cache_key = f'appointments:today:{today}'
    cached    = cache_get(cache_key)
    if cached:
        return jsonify({'appointments': cached, 'date': today, 'source': 'cache'}), 200

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)
        cursor.execute("""
            SELECT a.appointment_id, a.patient_id, a.doctor_id,
                   a.appointment_datetime, a.reason, a.status,
                   p.first_name, p.last_name, p.clinic_number,
                   d.full_name AS doctor_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.patient_id
            JOIN doctors  d ON a.doctor_id  = d.doctor_id
            WHERE a.status NOT IN ('Completed', 'Cancelled', 'No-show')
              AND DATE(a.appointment_datetime) >= CURDATE()
            ORDER BY a.appointment_datetime
            LIMIT 10
        """)
        appointments = cursor.fetchall()
        connection.close()
    except Exception as error:
        return jsonify({'error': "Could not retrieve upcoming appointments.", 'details': str(error)}), 503

    cache_set(cache_key, appointments, ttl=60)
    return jsonify({'appointments': appointments, 'date': today, 'source': 'db'}), 200


@appointments_bp.route('/appointments/week-summary', methods=['GET'])
@login_required
def get_week_summary():
    """Return appointment counts grouped by day for the current 7-day window."""
    cache_key = 'appointments:week-summary'
    cached    = cache_get(cache_key)
    if cached:
        return jsonify({'summary': cached, 'source': 'cache'}), 200

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)
        cursor.execute("""
            SELECT DATE(appointment_datetime) AS appointment_date,
                   COUNT(*) AS total,
                   SUM(status = 'Completed')  AS completed,
                   SUM(status = 'Cancelled')  AS cancelled,
                   SUM(status = 'No-show')    AS no_show,
                   SUM(status = 'Scheduled')  AS scheduled
            FROM appointments
            WHERE appointment_datetime BETWEEN CURDATE() - INTERVAL 6 DAY
                                           AND CURDATE() + INTERVAL 1 DAY
            GROUP BY DATE(appointment_datetime)
            ORDER BY appointment_date
        """)
        summary = cursor.fetchall()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not retrieve week summary.', 'details': str(error)}), 503

    cache_set(cache_key, summary, ttl=120)
    return jsonify({'summary': summary, 'source': 'db'}), 200


@appointments_bp.route('/appointments', methods=['POST'])
@login_required
def book_appointment():
    """Book a new appointment after validating the doctor's schedule and checking for conflicts."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['patient_id', 'doctor_id', 'appointment_datetime']
    missing  = [field for field in required if not data.get(field)]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    try:
        appointment_datetime = datetime.strptime(data['appointment_datetime'], '%Y-%m-%d %H:%M:%S')
    except ValueError:
        return jsonify({'error': 'Invalid datetime format. Use: YYYY-MM-DD HH:MM:SS'}), 400

    if appointment_datetime.date() < datetime.now().date():
        return jsonify({'error': 'Appointment date cannot be in the past'}), 400

    day_name = appointment_datetime.strftime('%a')

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)

        # Verify the doctor works on the requested day
        cursor.execute("""
            SELECT schedule_id FROM doctor_schedule
            WHERE doctor_id = %s AND day_of_week = %s
        """, (data['doctor_id'], day_name))
        if not cursor.fetchone():
            connection.close()
            return jsonify({
                'error': f"Doctor is not available on {appointment_datetime.strftime('%A')}s. "
                          "Please choose a different day."
            }), 409

        # Check for a conflicting booking within 30 minutes of the requested slot
        cursor.execute("""
            SELECT appointment_id FROM appointments
            WHERE doctor_id = %s
              AND status    = 'Scheduled'
              AND ABS(TIMESTAMPDIFF(MINUTE, appointment_datetime, %s)) < 30
        """, (data['doctor_id'], data['appointment_datetime']))
        if cursor.fetchone():
            connection.close()
            return jsonify({'error': 'This time slot is already booked. Please choose another time.'}), 409

        cursor = connection.cursor()
        cursor.execute("""
            INSERT INTO appointments (patient_id, doctor_id, appointment_datetime, reason, status)
            VALUES (%s, %s, %s, %s, 'Scheduled')
        """, (
            data['patient_id'],
            data['doctor_id'],
            data['appointment_datetime'],
            data.get('reason', '')
        ))
        connection.commit()
        new_id = cursor.lastrowid
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Booking failed. Please try again.', 'details': str(error)}), 503

    cache_invalidate('appointments')
    return jsonify({'id': new_id, 'message': 'Appointment booked successfully'}), 201


@appointments_bp.route('/appointments/<int:appointment_id>', methods=['PATCH'])
@login_required
def update_appointment_status(appointment_id):
    """Update the status of an existing appointment."""
    data       = request.get_json()
    new_status = data.get('status') if data else None

    valid_statuses = ('Scheduled', 'Completed', 'Cancelled', 'No-show')
    if new_status not in valid_statuses:
        return jsonify({'error': f'Status must be one of: {", ".join(valid_statuses)}'}), 400

    try:
        connection = get_db_connection()
        cursor     = connection.cursor()
        cursor.execute(
            "UPDATE appointments SET status = %s WHERE appointment_id = %s",
            (new_status, appointment_id)
        )
        connection.commit()
        affected_rows = cursor.rowcount
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Update failed.', 'details': str(error)}), 503

    if affected_rows == 0:
        return jsonify({'error': 'Appointment not found'}), 404

    cache_invalidate('appointments')
    return jsonify({'message': f'Appointment marked as {new_status}'}), 200
