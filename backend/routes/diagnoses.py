from flask import Blueprint, jsonify, request
from config import get_db_connection
from routes.auth import login_required, role_required

diagnoses_bp = Blueprint('diagnoses', __name__)


@diagnoses_bp.route('/patients/<int:patient_id>/diagnoses', methods=['GET'])
@login_required
def get_patient_diagnoses(patient_id):
    """Retrieve all diagnoses for a specific patient with visit date and doctor information."""
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        
        cursor.execute("""
            SELECT d.diagnosis_id, d.visit_id, d.description, mv.visit_date, doc.full_name AS doctor_name
            FROM diagnoses d
            JOIN medical_visits mv ON d.visit_id = mv.visit_id
            LEFT JOIN doctors doc ON mv.doctor_id = doc.doctor_id
            WHERE mv.patient_id = %s
            ORDER BY mv.visit_date DESC
        """, (patient_id,))
        
        diagnoses = cursor.fetchall()
        
        cursor.close()
        connection.close()
        
        return jsonify({'diagnoses': diagnoses}), 200
        
    except Exception as error:
        return jsonify({'error': str(error)}), 500


@diagnoses_bp.route('/visits/<int:visit_id>/diagnoses', methods=['POST'])
@role_required('doctor', 'admin')
def create_diagnosis(visit_id):
    """Create a new diagnosis record."""
    try:
        data = request.get_json() or {}
        if not data.get('description'):
            return jsonify({'error': 'description is required'}), 400
        
        connection = get_db_connection()
        cursor = connection.cursor()
        
        cursor.execute("""
            INSERT INTO diagnoses (visit_id, description)
            VALUES (%s, %s)
        """, (visit_id, data.get('description')))
        
        connection.commit()
        diagnosis_id = cursor.lastrowid
        
        cursor.close()
        connection.close()
        
        return jsonify({'diagnosis_id': diagnosis_id, 'message': 'Diagnosis created successfully'}), 201
        
    except Exception as error:
        return jsonify({'error': str(error)}), 500
