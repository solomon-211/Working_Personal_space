from flask import Blueprint, request, jsonify
from config import get_db_connection
from cache import cache_get, cache_set, cache_invalidate
from routes.auth import login_required

patients_bp = Blueprint('patients', __name__)


# route to get all patients, with optional search by name or clinic number
@patients_bp.route('/patients', methods=['GET'])
@login_required
def get_patients():
    search = request.args.get('search', '').strip()

    # Build a cache key that includes the search term so different searches  are cached independently.
    cache_key = f'patients:{search}'
    cached = cache_get(cache_key)
    if cached:
        # Serve from cache — no DB call needed
        return jsonify({'patients': cached, 'source': 'cache'}), 200

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        if search:
            like = f'%{search}%'
            cursor.execute("""
                SELECT patient_id, first_name, last_name, date_of_birth,
                       gender, phone, email, blood_type, clinic_number,
                       insurance_provider, registered_at
                FROM patients
                WHERE first_name LIKE %s
                   OR last_name  LIKE %s
                   OR clinic_number LIKE %s
                ORDER BY last_name
            """, (like, like, like))
        else:
            cursor.execute("""
                SELECT patient_id, first_name, last_name, date_of_birth,
                       gender, phone, email, blood_type, clinic_number,
                       insurance_provider, registered_at
                FROM patients
                ORDER BY last_name
            """)

        patients = cursor.fetchall()
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not retrieve patients. Check connection.', 'details': str(e)}), 503

    # Store in cache for 30 s
    cache_set(cache_key, patients)
    return jsonify({'patients': patients, 'source': 'db'}), 200


# route to register a new patient
@patients_bp.route('/patients', methods=['POST'])
@login_required
def register_patient():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    # Validate required fields before touching the database
    required = ['first_name', 'last_name', 'date_of_birth', 'gender', 'clinic_number']
    missing  = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    try:
        conn   = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO patients (
                first_name, last_name, date_of_birth, gender,
                phone, email, address, blood_type,
                emergency_contact, insurance_provider,
                national_id, clinic_number
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (
            data['first_name'],            data['last_name'],
            data['date_of_birth'],         data['gender'],
            data.get('phone'),             data.get('email'),
            data.get('address'),           data.get('blood_type'),
            data.get('emergency_contact'), data.get('insurance_provider'),
            data.get('national_id'),       data['clinic_number']
        ))
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
    except mysql_error(1062):
        # Duplicate clinic_number — give a specific, helpful message
        return jsonify({'error': f"Clinic number '{data['clinic_number']}' is already registered"}), 409
    except Exception as e:
        return jsonify({'error': 'Registration failed. Please try again.', 'details': str(e)}), 503

    # Invalidate the patients list cache so the new patient appears
    cache_invalidate('patients')

    return jsonify({'id': new_id, 'clinic_number': data['clinic_number']}), 201


# route to get a single patient by ID
@patients_bp.route('/patients/<int:patient_id>', methods=['GET'])
@login_required
def get_patient(patient_id):
    cache_key = f'patients:id:{patient_id}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify({'patient': cached, 'source': 'cache'}), 200

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM patients WHERE patient_id = %s", (patient_id,))
        patient = cursor.fetchone()
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not retrieve patient.', 'details': str(e)}), 503

    if not patient:
        return jsonify({'error': 'Patient not found'}), 404

    cache_set(cache_key, patient)
    return jsonify({'patient': patient, 'source': 'db'}), 200


# route to update patient info (only certain fields allowed for update)
@patients_bp.route('/patients/<int:patient_id>', methods=['PATCH'])
@login_required
def update_patient(patient_id):
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    # Only allow safe, updatable fields — never let the caller overwrite patient_id
    allowed_fields = ['phone', 'email', 'address', 'emergency_contact',
                      'insurance_provider', 'blood_type']
    updates = {k: v for k, v in data.items() if k in allowed_fields}

    if not updates:
        return jsonify({'error': 'No valid fields provided to update'}), 400

    # Dynamically build the SET clause from whichever fields were sent
    set_clause = ', '.join(f"{col} = %s" for col in updates)
    values     = list(updates.values()) + [patient_id]

    try:
        conn   = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE patients SET {set_clause} WHERE patient_id = %s",
            values
        )
        conn.commit()
        affected = cursor.rowcount
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Update failed.', 'details': str(e)}), 503

    if affected == 0:
        return jsonify({'error': 'Patient not found'}), 404

    # Clear cache for this patient so next GET returns fresh data
    cache_invalidate(f'patients:id:{patient_id}')
    cache_invalidate('patients:')

    return jsonify({'message': 'Patient updated successfully'}), 200


# Local helper to catch duplicate-entry errors by code
def mysql_error(code):
    """Returns the mysql.connector IntegrityError class for use in except clauses."""
    import mysql.connector
    class _Err(Exception):
        pass
    # Return the real error class filtered by code
    class CodedError(mysql.connector.IntegrityError):
        pass
    return CodedError