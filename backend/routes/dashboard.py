from flask import Blueprint, jsonify
from config import get_db_connection
from routes.auth import login_required

dashboard_bp = Blueprint('dashboard', __name__)


@dashboard_bp.route('/dashboard/stats', methods=['GET'])
@login_required
def get_dashboard_stats():
    """Retrieve summary statistics for the dashboard.
    
    Returns counts and values for key metrics including total patients,
    today's appointments, unpaid invoices, pending payments, and daily revenue.
    """
    connection = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        
        stats = {}
        
        cursor.execute("SELECT COUNT(*) as count FROM patients")
        stats['total_patients'] = cursor.fetchone()['count']
        
        cursor.execute("SELECT COUNT(*) as count FROM appointments WHERE status NOT IN ('Completed','Cancelled','No-show') AND DATE(appointment_datetime) >= CURDATE()")
        stats['today_appointments'] = cursor.fetchone()['count']
        
        cursor.execute("SELECT COUNT(*) as count FROM invoices WHERE payment_status = 'Unpaid'")
        stats['unpaid_invoices'] = cursor.fetchone()['count']

        cursor.execute("SELECT COALESCE(SUM(amount_due), 0) as total FROM invoices WHERE payment_status IN ('Unpaid', 'Partial')")
        stats['pending_payments'] = float(cursor.fetchone()['total'])

        cursor.execute("SELECT COALESCE(SUM(amount_paid), 0) as total FROM payments WHERE payment_date = CURDATE()")
        stats['today_revenue'] = float(cursor.fetchone()['total'])
        
        return jsonify(stats), 200
        
    except Exception:
        return jsonify({'error': 'Failed to retrieve dashboard stats'}), 500
    finally:
        if connection:
            connection.close()
