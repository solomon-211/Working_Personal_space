from flask import Blueprint, request, jsonify
from config import get_db_connection
from cache import cache_get, cache_set
from routes.auth import login_required

doctors_bp = Blueprint('doctors', __name__)


@doctors_bp.route('/doctors', methods=['GET'])
@login_required
def get_doctors():
    """Return all active doctors ordered by name."""
    cached = cache_get('doctors:active')
    if cached:
        return jsonify({'doctors': cached, 'source': 'cache'}), 200

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)
        cursor.execute("""
            SELECT doctor_id, full_name, specialization, phone, email
            FROM doctors
            WHERE is_active = 1
            ORDER BY full_name
        """)
        doctors = cursor.fetchall()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not retrieve doctors.', 'details': str(error)}), 503

    # Doctors change rarely so a 5-minute cache is safe
    cache_set('doctors:active', doctors, ttl=300)
    return jsonify({'doctors': doctors, 'source': 'db'}), 200


@doctors_bp.route('/doctor-schedules', methods=['GET'])
@login_required
def get_all_schedules():
    """Return weekly schedule rows for all active doctors."""
    cached = cache_get('doctor-schedules:all')
    if cached:
        return jsonify({'schedules': cached, 'source': 'cache'}), 200

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)
        cursor.execute("""
            SELECT ds.schedule_id, ds.day_of_week, ds.start_time,
                   d.doctor_id, d.full_name, d.specialization
            FROM doctor_schedule ds
            JOIN doctors d ON ds.doctor_id = d.doctor_id
            WHERE d.is_active = 1
            ORDER BY d.full_name, ds.day_of_week
        """)
        schedules = cursor.fetchall()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not retrieve schedules.', 'details': str(error)}), 503

    # MySQL returns TIME columns as timedelta objects; convert to HH:MM:SS strings for JSON
    from datetime import timedelta
    for schedule in schedules:
        raw_time = schedule.get('start_time')
        if isinstance(raw_time, timedelta):
            total_seconds        = int(raw_time.total_seconds())
            schedule['start_time'] = f'{total_seconds // 3600:02d}:{(total_seconds % 3600) // 60:02d}:00'
        else:
            schedule['start_time'] = str(raw_time) if raw_time else None

    cache_set('doctor-schedules:all', schedules, ttl=60)
    return jsonify({'schedules': schedules, 'source': 'db'}), 200


@doctors_bp.route('/doctor-schedules/<int:doctor_id>', methods=['GET'])
@login_required
def get_available_slots(doctor_id):
    """
    Return availability and already-booked slots for a doctor on a given date.
    Requires a ?date=YYYY-MM-DD query parameter.
    Slot availability is never cached because it changes as appointments are booked.
    """
    appointment_date = request.args.get('date')
    if not appointment_date:
        return jsonify({'error': 'Please provide a ?date=YYYY-MM-DD query parameter'}), 400

    try:
        from datetime import datetime, timedelta
        day_name = datetime.strptime(appointment_date, '%Y-%m-%d').strftime('%a')
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)

        cursor.execute(
            'SELECT start_time FROM doctor_schedule WHERE doctor_id = %s AND day_of_week = %s',
            (doctor_id, day_name)
        )
        schedule_row = cursor.fetchone()

        if not schedule_row:
            connection.close()
            return jsonify({'available': False, 'message': 'Doctor does not work on this day'}), 200

        # Convert timedelta or string to a plain HH:MM:SS string
        raw_time = schedule_row['start_time']
        if isinstance(raw_time, timedelta):
            total_seconds  = int(raw_time.total_seconds())
            start_time_str = f'{total_seconds // 3600:02d}:{(total_seconds % 3600) // 60:02d}:00'
        else:
            start_time_str = str(raw_time)

        cursor.execute(
            "SELECT appointment_datetime FROM appointments "
            "WHERE doctor_id = %s AND DATE(appointment_datetime) = %s AND status = 'Scheduled'",
            (doctor_id, appointment_date)
        )
        booked_slots = [str(row['appointment_datetime']) for row in cursor.fetchall()]
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not check availability.', 'details': str(error)}), 503

    return jsonify({
        'doctor_id':    doctor_id,
        'date':         appointment_date,
        'available':    True,
        'start_time':   start_time_str,
        'booked_slots': booked_slots
    }), 200
