from flask import Blueprint, request, jsonify
from config import get_db_connection
from cache import cache_get, cache_set, cache_invalidate
from routes.auth import login_required, role_required

medical_visits_bp = Blueprint('medical_visits', __name__)


# route to get all medical visits for a patient, with attached diagnoses and prescriptions
@medical_visits_bp.route('/medical-visits/<int:patient_id>', methods=['GET'])
@login_required
def get_patient_visits(patient_id):
    """Returns all visits for a patient, newest first, with diagnoses attached."""
    cache_key = f'medical-visits:{patient_id}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify({'visits': cached, 'source': 'cache'}), 200

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        # Fetch all visits for this patient, including invoice status linked by visit_id
        cursor.execute("""
            SELECT v.visit_id, v.visit_date, v.notes,
                   d.full_name AS doctor_name,
                   v.appointment_id,
                   CASE WHEN i.invoice_id IS NOT NULL THEN 1 ELSE 0 END AS has_invoice,
                   i.invoice_id AS linked_invoice_id
            FROM medical_visits v
            JOIN doctors d ON v.doctor_id = d.doctor_id
            LEFT JOIN invoices i ON i.visit_id = v.visit_id
            WHERE v.patient_id = %s
            ORDER BY v.visit_date DESC
        """, (patient_id,))
        visits = cursor.fetchall()

        # For each visit, attach its diagnoses and prescriptions
        # This avoids extra round-trips from the frontend
        for visit in visits:
            cursor.execute("""
                SELECT description FROM diagnoses WHERE visit_id = %s
            """, (visit['visit_id'],))
            visit['diagnoses'] = [row['description'] for row in cursor.fetchall()]

            cursor.execute("""
                SELECT drug_name, dosage, duration FROM prescriptions WHERE visit_id = %s
            """, (visit['visit_id'],))
            visit['prescriptions'] = cursor.fetchall()

        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not retrieve visits.', 'details': str(e)}), 503

    cache_set(cache_key, visits)
    return jsonify({'visits': visits, 'source': 'db'}), 200


# route to add a new medical visit record (e.g. when a patient is seen by a doctor)
@medical_visits_bp.route('/medical-visits', methods=['POST'])
@role_required('doctor', 'admin')   # only doctors or admins can create visit records
def add_visit():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['patient_id', 'doctor_id', 'visit_date']
    missing  = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    try:
        conn   = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO medical_visits (patient_id, doctor_id, appointment_id, visit_date, notes)
            VALUES (%s, %s, %s, %s, %s)
        """, (
            data['patient_id'],
            data['doctor_id'],
            data.get('appointment_id'),  # nullable — walk-ins won't have this
            data['visit_date'],
            data.get('notes', '')
        ))
        conn.commit()
        visit_id = cursor.lastrowid
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not create visit record.', 'details': str(e)}), 503

    cache_invalidate(f'medical-visits:{data["patient_id"]}')
    return jsonify({'visit_id': visit_id, 'message': 'Visit recorded'}), 201


# route to get diagnoses for a specific visit (for detailed view)
@medical_visits_bp.route('/diagnoses/<int:visit_id>', methods=['GET'])
@login_required
def get_diagnoses(visit_id):
    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM diagnoses WHERE visit_id = %s", (visit_id,))
        diagnoses = cursor.fetchall()
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not retrieve diagnoses.', 'details': str(e)}), 503

    return jsonify({'diagnoses': diagnoses}), 200


# route to add a diagnosis to a visit (e.g. after the doctor has made an assessment)
@medical_visits_bp.route('/diagnoses', methods=['POST'])
@role_required('doctor', 'admin')
def add_diagnosis():
    data = request.get_json()
    if not data or not data.get('visit_id') or not data.get('description'):
        return jsonify({'error': 'visit_id and description are required'}), 400

    try:
        conn   = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO diagnoses (visit_id, description) VALUES (%s, %s)",
            (data['visit_id'], data['description'])
        )
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not save diagnosis.', 'details': str(e)}), 503

    return jsonify({'diagnosis_id': new_id}), 201


# route to get all prescriptions for a patient (for the prescriptions tab in patient profile)
@medical_visits_bp.route('/prescriptions/<int:patient_id>', methods=['GET'])
@login_required
def get_prescriptions(patient_id):
    cache_key = f'prescriptions:{patient_id}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify({'prescriptions': cached, 'source': 'cache'}), 200

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT pr.prescription_id, pr.drug_name, pr.dosage, pr.duration,
                   pr.end_time, v.visit_date
            FROM prescriptions pr
            JOIN medical_visits v ON pr.visit_id = v.visit_id
            WHERE v.patient_id = %s
            ORDER BY v.visit_date DESC
        """, (patient_id,))
        prescriptions = cursor.fetchall()
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not retrieve prescriptions.', 'details': str(e)}), 503

    cache_set(cache_key, prescriptions)
    return jsonify({'prescriptions': prescriptions, 'source': 'db'}), 200


# route to add a new prescription for a visit (e.g. when the doctor prescribes medication during the consultation)
@medical_visits_bp.route('/prescriptions', methods=['POST'])
@role_required('doctor', 'admin')
def add_prescription():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['visit_id', 'drug_name']
    missing  = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    try:
        conn   = get_db_connection()
        cursor = conn.cursor()
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
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not save prescription.', 'details': str(e)}), 503

    # Clear the patient's prescription cache
    cache_invalidate(f'prescriptions:')
    return jsonify({'prescription_id': new_id}), 201