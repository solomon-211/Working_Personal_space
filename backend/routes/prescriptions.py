from flask import Blueprint, jsonify, request
from config import get_db_connection
from routes.auth import login_required, role_required

prescriptions_bp = Blueprint('prescriptions', __name__)


@prescriptions_bp.route('/patients/<int:patient_id>/prescriptions', methods=['GET'])
@login_required
def get_patient_prescriptions(patient_id):
    """Retrieve all prescriptions for a specific patient."""
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        
        cursor.execute("""
            SELECT p.prescription_id, p.visit_id, p.drug_name, p.dosage, p.duration,
                   p.end_time, mv.visit_date
            FROM prescriptions p
            JOIN medical_visits mv ON p.visit_id = mv.visit_id
            WHERE mv.patient_id = %s
            ORDER BY mv.visit_date DESC, p.prescription_id DESC
        """, (patient_id,))
        
        prescriptions = cursor.fetchall()
        
        cursor.close()
        connection.close()
        
        return jsonify({'prescriptions': prescriptions}), 200
        
    except Exception as error:
        return jsonify({'error': str(error)}), 500


@prescriptions_bp.route('/visits/<int:visit_id>/prescriptions', methods=['POST'])
@role_required('doctor', 'admin')
def create_prescription(visit_id):
    """Create a new prescription record."""
    try:
        data = request.get_json() or {}
        if not data.get('drug_name'):
            return jsonify({'error': 'drug_name is required'}), 400
        
        connection = get_db_connection()
        cursor = connection.cursor()
        
        cursor.execute("""
            INSERT INTO prescriptions (visit_id, drug_name, dosage, duration, end_time)
            VALUES (%s, %s, %s, %s, %s)
        """, (visit_id, data.get('drug_name'), data.get('dosage'), data.get('duration'), data.get('end_time')))
        
        connection.commit()
        prescription_id = cursor.lastrowid
        
        cursor.close()
        connection.close()
        
        return jsonify({'prescription_id': prescription_id, 'message': 'Prescription created successfully'}), 201
        
    except Exception as error:
        return jsonify({'error': str(error)}), 500
