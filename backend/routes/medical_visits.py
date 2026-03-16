from flask import Blueprint, request, jsonify
from typing import Any, Dict, List, cast
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

        # Fetch all visits for this patient
        cursor.execute("""
            SELECT v.visit_id, v.visit_date, v.notes,
                   d.full_name AS doctor_name
            FROM medical_visits v
            JOIN doctors d ON v.doctor_id = d.doctor_id
            WHERE v.patient_id = %s
            ORDER BY v.visit_date DESC
        """, (patient_id,))
        visits = cast(List[Dict[str, Any]], cursor.fetchall() or [])

        # For each visit, attach its diagnoses and prescriptions
        # This avoids extra round-trips from the frontend
        for visit in visits:
            cursor.execute("""
                SELECT description FROM diagnoses WHERE visit_id = %s
            """, (visit['visit_id'],))
            diag_rows = cast(List[Dict[str, Any]], cursor.fetchall() or [])
            visit['diagnoses'] = [row.get('description') for row in diag_rows if row.get('description')]

            cursor.execute("""
                SELECT drug_name, dosage, duration FROM prescriptions WHERE visit_id = %s
            """, (visit['visit_id'],))
            visit['prescriptions'] = cast(List[Dict[str, Any]], cursor.fetchall() or [])

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


# route to get a single visit with its full diagnoses and prescriptions (for the invoice modal)
@medical_visits_bp.route('/visits/<int:visit_id>/summary', methods=['GET'])
@login_required
def get_visit_summary(visit_id):
    """Returns a single visit record with attached diagnoses and prescriptions."""
    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT v.visit_id, v.visit_date, v.notes,
                   d.full_name AS doctor_name
            FROM medical_visits v
            JOIN doctors d ON v.doctor_id = d.doctor_id
            WHERE v.visit_id = %s
        """, (visit_id,))
        visit = cast(Dict[str, Any], cursor.fetchone() or {})

        if not visit:
            conn.close()
            return jsonify({'error': 'Visit not found'}), 404

        cursor.execute(
            "SELECT description FROM diagnoses WHERE visit_id = %s", (visit_id,)
        )
        diag_rows = cast(List[Dict[str, Any]], cursor.fetchall() or [])
        visit['diagnoses'] = [row.get('description') for row in diag_rows if row.get('description')]

        cursor.execute(
            "SELECT drug_name, dosage, duration FROM prescriptions WHERE visit_id = %s",
            (visit_id,)
        )
        visit['prescriptions'] = cast(List[Dict[str, Any]], cursor.fetchall() or [])

        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not retrieve visit summary.', 'details': str(e)}), 503

    return jsonify({'visit': visit}), 200


# route to save a full consultation in one request: visit + diagnoses + prescriptions
@medical_visits_bp.route('/consultations', methods=['POST'])
@role_required('doctor', 'admin')
def save_consultation():
    """
    Creates a visit, bulk-inserts diagnoses and prescriptions, and marks
    the linked appointment as 'Completed' — all in one transaction.
    Expected body:
    {
        "patient_id": 1,
        "doctor_id": 2,
        "appointment_id": 5,           (optional)
        "visit_date": "2025-06-10",
        "notes": "...",                (optional)
        "diagnoses": ["Flu", "..."],   (optional)
        "prescriptions": [
            { "drug_name": "Paracetamol", "dosage": "500mg", "duration": "5 days" }
        ]                              (optional)
    }
    """
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

        # Insert the visit record
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
        visit_id = cursor.lastrowid

        # Bulk-insert diagnoses
        for desc in (data.get('diagnoses') or []):
            if desc:
                cursor.execute(
                    "INSERT INTO diagnoses (visit_id, description) VALUES (%s, %s)",
                    (visit_id, desc)
                )

        # Bulk-insert prescriptions
        for rx in (data.get('prescriptions') or []):
            if rx.get('drug_name'):
                cursor.execute("""
                    INSERT INTO prescriptions (visit_id, drug_name, dosage, duration)
                    VALUES (%s, %s, %s, %s)
                """, (visit_id, rx['drug_name'], rx.get('dosage'), rx.get('duration')))

        # Mark the linked appointment as Completed
        if data.get('appointment_id'):
            cursor.execute(
                "UPDATE appointments SET status = 'Completed' WHERE appointment_id = %s",
                (data['appointment_id'],)
            )

        conn.commit()
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not save consultation.', 'details': str(e)}), 503

    cache_invalidate(f'medical-visits:{data["patient_id"]}')
    cache_invalidate('appointments:')
    return jsonify({'visit_id': visit_id, 'message': 'Consultation saved'}), 201