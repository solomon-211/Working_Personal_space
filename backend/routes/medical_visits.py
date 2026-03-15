from flask import Blueprint, request, jsonify
from config import get_db_connection
from cache import cache_get, cache_set, cache_invalidate
from routes.auth import login_required, role_required

medical_visits_bp = Blueprint('medical_visits', __name__)


@medical_visits_bp.route('/medical-visits/<int:patient_id>', methods=['GET'])
@login_required
def get_patient_visits(patient_id):
    """Return all visits for a patient, newest first, with diagnoses and prescriptions attached."""
    cache_key = f'medical-visits:{patient_id}'
    cached    = cache_get(cache_key)
    if cached:
        return jsonify({'visits': cached, 'source': 'cache'}), 200

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT v.visit_id, v.visit_date, v.notes,
                   d.full_name AS doctor_name
            FROM medical_visits v
            JOIN doctors d ON v.doctor_id = d.doctor_id
            WHERE v.patient_id = %s
            ORDER BY v.visit_date DESC
        """, (patient_id,))
        visits = cursor.fetchall()

        for visit in visits:
            cursor.execute(
                "SELECT description FROM diagnoses WHERE visit_id = %s",
                (visit['visit_id'],)
            )
            visit['diagnoses'] = [row['description'] for row in cursor.fetchall()]

            cursor.execute(
                "SELECT drug_name, dosage, duration FROM prescriptions WHERE visit_id = %s",
                (visit['visit_id'],)
            )
            visit['prescriptions'] = cursor.fetchall()

        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not retrieve visits.', 'details': str(error)}), 503

    cache_set(cache_key, visits)
    return jsonify({'visits': visits, 'source': 'db'}), 200


@medical_visits_bp.route('/medical-visits', methods=['POST'])
@role_required('doctor', 'admin')
def add_visit():
    """Create a standalone visit record (used for walk-ins without a prior appointment)."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['patient_id', 'doctor_id', 'visit_date']
    missing  = [field for field in required if not data.get(field)]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    try:
        connection = get_db_connection()
        cursor     = connection.cursor()
        cursor.execute("""
            INSERT INTO medical_visits (patient_id, doctor_id, appointment_id, visit_date, notes)
            VALUES (%s, %s, %s, %s, %s)
        """, (
            data['patient_id'],
            data['doctor_id'],
            data.get('appointment_id'),
            data['visit_date'],
            data.get('notes', '')
        ))
        connection.commit()
        visit_id = cursor.lastrowid
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not create visit record.', 'details': str(error)}), 503

    cache_invalidate(f'medical-visits:{data["patient_id"]}')
    return jsonify({'visit_id': visit_id, 'message': 'Visit recorded'}), 201


@medical_visits_bp.route('/diagnoses/<int:visit_id>', methods=['GET'])
@login_required
def get_diagnoses(visit_id):
    """Return all diagnoses for a specific visit."""
    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)
        cursor.execute("SELECT * FROM diagnoses WHERE visit_id = %s", (visit_id,))
        diagnoses = cursor.fetchall()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not retrieve diagnoses.', 'details': str(error)}), 503

    return jsonify({'diagnoses': diagnoses}), 200


@medical_visits_bp.route('/diagnoses', methods=['POST'])
@role_required('doctor', 'admin')
def add_diagnosis():
    """Add a single diagnosis to an existing visit."""
    data = request.get_json()
    if not data or not data.get('visit_id') or not data.get('description'):
        return jsonify({'error': 'visit_id and description are required'}), 400

    try:
        connection = get_db_connection()
        cursor     = connection.cursor()
        cursor.execute(
            "INSERT INTO diagnoses (visit_id, description) VALUES (%s, %s)",
            (data['visit_id'], data['description'])
        )
        connection.commit()
        new_id = cursor.lastrowid
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not save diagnosis.', 'details': str(error)}), 503

    return jsonify({'diagnosis_id': new_id}), 201


@medical_visits_bp.route('/prescriptions/<int:patient_id>', methods=['GET'])
@login_required
def get_prescriptions(patient_id):
    """Return all prescriptions for a patient, ordered by most recent visit first."""
    cache_key = f'prescriptions:{patient_id}'
    cached    = cache_get(cache_key)
    if cached:
        return jsonify({'prescriptions': cached, 'source': 'cache'}), 200

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)
        cursor.execute("""
            SELECT pr.prescription_id, pr.drug_name, pr.dosage, pr.duration,
                   pr.end_time, v.visit_date
            FROM prescriptions pr
            JOIN medical_visits v ON pr.visit_id = v.visit_id
            WHERE v.patient_id = %s
            ORDER BY v.visit_date DESC
        """, (patient_id,))
        prescriptions = cursor.fetchall()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not retrieve prescriptions.', 'details': str(error)}), 503

    cache_set(cache_key, prescriptions)
    return jsonify({'prescriptions': prescriptions, 'source': 'db'}), 200


@medical_visits_bp.route('/prescriptions', methods=['POST'])
@role_required('doctor', 'admin')
def add_prescription():
    """Add a single prescription to an existing visit."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['visit_id', 'drug_name']
    missing  = [field for field in required if not data.get(field)]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    try:
        connection = get_db_connection()
        cursor     = connection.cursor()
        cursor.execute("""
            INSERT INTO prescriptions (visit_id, drug_name, dosage, duration, end_time)
            VALUES (%s, %s, %s, %s, %s)
        """, (
            data['visit_id'],
            data['drug_name'],
            data.get('dosage'),
            data.get('duration'),
            data.get('end_time')
        ))
        connection.commit()
        new_id = cursor.lastrowid
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not save prescription.', 'details': str(error)}), 503

    cache_invalidate('prescriptions:')
    return jsonify({'prescription_id': new_id}), 201


@medical_visits_bp.route('/visits/<int:visit_id>/summary', methods=['GET'])
@login_required
def get_visit_summary(visit_id):
    """Return a full visit summary including notes, diagnoses, and prescriptions."""
    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT v.visit_id, v.visit_date, v.notes,
                   v.patient_id, v.appointment_id,
                   d.full_name AS doctor_name
            FROM medical_visits v
            JOIN doctors d ON v.doctor_id = d.doctor_id
            WHERE v.visit_id = %s
        """, (visit_id,))
        visit = cursor.fetchone()

        if not visit:
            connection.close()
            return jsonify({'error': 'Visit not found'}), 404

        cursor.execute("SELECT description FROM diagnoses WHERE visit_id = %s", (visit_id,))
        visit['diagnoses'] = [row['description'] for row in cursor.fetchall()]

        cursor.execute(
            "SELECT drug_name, dosage, duration FROM prescriptions WHERE visit_id = %s",
            (visit_id,)
        )
        visit['prescriptions'] = cursor.fetchall()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not retrieve visit summary.', 'details': str(error)}), 503

    return jsonify({'visit': visit}), 200


@medical_visits_bp.route('/consultations', methods=['POST'])
@role_required('doctor', 'admin')
def complete_consultation():
    """
    Save a full consultation in a single transaction:
    inserts the visit record, all diagnoses, all prescriptions,
    and marks the linked appointment as Completed.
    """
    from datetime import datetime, timedelta
    from flask import session as flask_session

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['patient_id', 'appointment_id', 'visit_date']
    missing  = [field for field in required if not data.get(field)]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    diagnoses     = data.get('diagnoses', [])
    prescriptions = data.get('prescriptions', [])

    connection = None
    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)

        # Resolve doctor_id: prefer session, then request body, then database lookup
        doctor_id = flask_session.get('doctor_id') or data.get('doctor_id')
        if not doctor_id:
            cursor.execute("""
                SELECT d.doctor_id FROM doctors d
                INNER JOIN users u ON u.fullname = d.full_name
                WHERE u.username = %s LIMIT 1
            """, (flask_session.get('username'),))
            lookup_row = cursor.fetchone()
            if not lookup_row:
                return jsonify({'error': 'Could not identify doctor. Please log out and log back in.'}), 400
            doctor_id = lookup_row['doctor_id']

        cursor.execute("""
            INSERT INTO medical_visits (patient_id, doctor_id, appointment_id, visit_date, notes)
            VALUES (%s, %s, %s, %s, %s)
        """, (
            data['patient_id'], doctor_id,
            data['appointment_id'], data['visit_date'],
            data.get('notes', '')
        ))
        visit_id = cursor.lastrowid

        for description in diagnoses:
            description = (description or '').strip()
            if description:
                cursor.execute(
                    "INSERT INTO diagnoses (visit_id, description) VALUES (%s, %s)",
                    (visit_id, description)
                )

        for prescription in prescriptions:
            drug_name = (prescription.get('drug_name') or '').strip()
            if not drug_name:
                continue

            end_time = prescription.get('end_time') or None
            if not end_time and prescription.get('duration'):
                try:
                    days     = int(''.join(filter(str.isdigit, str(prescription['duration']))))
                    end_time = (
                        datetime.strptime(data['visit_date'], '%Y-%m-%d') + timedelta(days=days)
                    ).strftime('%Y-%m-%d %H:%M:%S')
                except Exception:
                    end_time = None

            cursor.execute("""
                INSERT INTO prescriptions (visit_id, drug_name, dosage, duration, end_time)
                VALUES (%s, %s, %s, %s, %s)
            """, (visit_id, drug_name, prescription.get('dosage'), prescription.get('duration'), end_time))

        cursor.execute(
            "UPDATE appointments SET status = 'Completed' WHERE appointment_id = %s",
            (data['appointment_id'],)
        )

        connection.commit()
    except Exception as error:
        if connection:
            try:
                connection.rollback()
            except Exception:
                pass
        return jsonify({'error': 'Could not save consultation.', 'details': str(error)}), 503
    finally:
        if connection:
            try:
                connection.close()
            except Exception:
                pass

    cache_invalidate('appointments')
    cache_invalidate(f'medical-visits:{data["patient_id"]}')
    cache_invalidate('prescriptions:')
    return jsonify({'visit_id': visit_id, 'message': 'Consultation saved and appointment completed'}), 201
