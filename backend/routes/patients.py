from flask import Blueprint, request, jsonify
from config import get_db_connection
from cache import cache_get, cache_set, cache_invalidate
from routes.auth import login_required

patients_bp = Blueprint('patients', __name__)


@patients_bp.route('/patients', methods=['GET'])
@login_required
def get_patients():
    """Return all patients, with optional search by name or clinic number."""
    search = request.args.get('search', '').strip()

    cache_key = f'patients:{search}'
    cached    = cache_get(cache_key)
    if cached:
        return jsonify({'patients': cached, 'source': 'cache'}), 200

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)

        if search:
            like_pattern = f'%{search}%'
            cursor.execute("""
                SELECT patient_id, first_name, last_name, date_of_birth,
                       gender, phone, email, blood_type, clinic_number,
                       insurance_provider, registered_at
                FROM patients
                WHERE first_name LIKE %s
                   OR last_name  LIKE %s
                   OR clinic_number LIKE %s
                ORDER BY last_name
            """, (like_pattern, like_pattern, like_pattern))
        else:
            cursor.execute("""
                SELECT patient_id, first_name, last_name, date_of_birth,
                       gender, phone, email, blood_type, clinic_number,
                       insurance_provider, registered_at
                FROM patients
                ORDER BY last_name
            """)

        patients = cursor.fetchall()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not retrieve patients. Check connection.', 'details': str(error)}), 503

    cache_set(cache_key, patients)
    return jsonify({'patients': patients, 'source': 'db'}), 200


@patients_bp.route('/patients', methods=['POST'])
@login_required
def register_patient():
    """Register a new patient. Clinic number must be unique."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['first_name', 'last_name', 'date_of_birth', 'gender', 'clinic_number']
    missing  = [field for field in required if not data.get(field)]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    try:
        connection = get_db_connection()
        cursor     = connection.cursor()
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
        connection.commit()
        new_id = cursor.lastrowid
        connection.close()
    except Exception as error:
        if hasattr(error, 'errno') and error.errno == 1062:
            return jsonify({'error': f"Clinic number '{data['clinic_number']}' is already registered"}), 409
        return jsonify({'error': 'Registration failed. Please try again.', 'details': str(error)}), 503

    cache_invalidate('patients')
    return jsonify({'id': new_id, 'clinic_number': data['clinic_number']}), 201


@patients_bp.route('/patients/<int:patient_id>', methods=['GET'])
@login_required
def get_patient(patient_id):
    """Return a single patient record by ID."""
    cache_key = f'patients:id:{patient_id}'
    cached    = cache_get(cache_key)
    if cached:
        return jsonify({'patient': cached, 'source': 'cache'}), 200

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)
        cursor.execute("SELECT * FROM patients WHERE patient_id = %s", (patient_id,))
        patient = cursor.fetchone()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not retrieve patient.', 'details': str(error)}), 503

    if not patient:
        return jsonify({'error': 'Patient not found'}), 404

    cache_set(cache_key, patient)
    return jsonify({'patient': patient, 'source': 'db'}), 200


@patients_bp.route('/patients/<int:patient_id>', methods=['PATCH'])
@login_required
def update_patient(patient_id):
    """Update allowed contact and insurance fields for a patient."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    allowed_fields = ['phone', 'email', 'address', 'emergency_contact',
                      'insurance_provider', 'blood_type']
    updates = {key: value for key, value in data.items() if key in allowed_fields}

    if not updates:
        return jsonify({'error': 'No valid fields provided to update'}), 400

    set_clause = ', '.join(f"{column} = %s" for column in updates)
    values     = list(updates.values()) + [patient_id]

    try:
        connection = get_db_connection()
        cursor     = connection.cursor()
        cursor.execute(
            f"UPDATE patients SET {set_clause} WHERE patient_id = %s",
            values
        )
        connection.commit()
        affected_rows = cursor.rowcount
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Update failed.', 'details': str(error)}), 503

    if affected_rows == 0:
        return jsonify({'error': 'Patient not found'}), 404

    cache_invalidate(f'patients:id:{patient_id}')
    cache_invalidate('patients:')
    return jsonify({'message': 'Patient updated successfully'}), 200
