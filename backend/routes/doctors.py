from flask import Blueprint, request, jsonify
from config import get_db_connection
from cache import cache_get, cache_set
from routes.auth import login_required
from typing import cast, Any

doctors_bp = Blueprint('doctors', __name__)


# route to get all active doctors
@doctors_bp.route('/doctors', methods=['GET'])
@login_required
def get_doctors():
    cached = cache_get('doctors:active')
    if cached:
        return jsonify({'doctors': cached, 'source': 'cache'}), 200

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT doctor_id, full_name, specialization, phone, email
            FROM doctors
            WHERE is_active = 1
            ORDER BY full_name
        """)
        doctors = cursor.fetchall()
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not retrieve doctors.', 'details': str(e)}), 503

    cache_set('doctors:active', doctors, ttl=300)
    return jsonify({'doctors': doctors, 'source': 'db'}), 200


# route to get the doctor schedules for all doctors (for admin dashboard)
@doctors_bp.route('/doctor-schedules', methods=['GET'])
@login_required
def get_all_schedules():
    cached = cache_get('doctor-schedules:all')
    if cached:
        for row in cached:
            s = cast(dict[str, Any], row)
            if hasattr(s.get('start_time'), 'total_seconds'):
                s['start_time'] = str(s['start_time'])
        return jsonify({'schedules': cached, 'source': 'cache'}), 200

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT ds.schedule_id, ds.day_of_week, ds.start_time,
                   d.doctor_id, d.full_name, d.specialization
            FROM doctor_schedule ds
            JOIN doctors d ON ds.doctor_id = d.doctor_id
            WHERE d.is_active = 1
            ORDER BY d.full_name, ds.day_of_week
        """)
        schedules = cursor.fetchall()
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not retrieve schedules.', 'details': str(e)}), 503

    for row in schedules:
        s = cast(dict[str, Any], row)
        if hasattr(s.get('start_time'), 'total_seconds'):
            s['start_time'] = str(s['start_time'])

    cache_set('doctor-schedules:all', schedules, ttl=300)
    return jsonify({'schedules': schedules, 'source': 'db'}), 200


@doctors_bp.route('/doctor-schedules/<int:doctor_id>', methods=['GET'])
@login_required
def get_available_slots(doctor_id):
    appt_date = request.args.get('date')
    if not appt_date:
        return jsonify({'error': 'Please provide a ?date=YYYY-MM-DD query parameter'}), 400

    cache_key = f'doctor-schedules:{doctor_id}:{appt_date}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached), 200

    try:
        from datetime import datetime
        day_name = datetime.strptime(appt_date, '%Y-%m-%d').strftime('%a')
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT start_time FROM doctor_schedule WHERE doctor_id = %s AND day_of_week = %s""", (doctor_id, day_name))
        schedule = cursor.fetchone()

        if not schedule:
            conn.close()
            return jsonify({'available': False, 'message': 'Doctor does not work on this day'}), 200

        cursor.execute("""
            SELECT appointment_datetime FROM appointments WHERE doctor_id = %s AND DATE(appointment_datetime) = %s AND status = 'Scheduled'
        """, (doctor_id, appt_date))
        booked = [cast(dict[str, Any], row)['appointment_datetime'] for row in cursor.fetchall()]
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not check availability.', 'details': str(e)}), 503

    result = {
        'doctor_id':   doctor_id,
        'date':        appt_date,
        'available':   True,
        'start_time':  str(cast(dict[str, Any], schedule)['start_time']),
        'booked_slots': [str(b) for b in booked]
    }
    cache_set(cache_key, result, ttl=60)
    return jsonify(result), 200
