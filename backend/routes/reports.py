from flask import Blueprint, request, jsonify
from config import get_db_connection
from cache import cache_get, cache_set
from routes.auth import login_required, role_required
from datetime import date

reports_bp = Blueprint('reports', __name__)


@reports_bp.route('/reports/dashboard-summary', methods=['GET'])
@login_required
def get_dashboard_summary():
    """Return aggregated key metrics for the dashboard (cached per day)."""
    today     = date.today().isoformat()
    cache_key = f'dashboard:stats:{today}'
    cached    = cache_get(cache_key)
    if cached:
        return jsonify({'stats': cached, 'source': 'cache'}), 200

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)

        cursor.execute("SELECT COUNT(*) AS total FROM patients")
        total_patients = cursor.fetchone()['total']

        cursor.execute("""
            SELECT status, COUNT(*) AS count
            FROM appointments
            WHERE DATE(appointment_datetime) = CURDATE()
            GROUP BY status
        """)
        appointments_today = {row['status']: row['count'] for row in cursor.fetchall()}

        cursor.execute("""
            SELECT COALESCE(SUM(amount_paid), 0) AS revenue
            FROM payments
            WHERE payment_date = CURDATE()
        """)
        revenue_today = float(cursor.fetchone()['revenue'])

        cursor.execute("SELECT COUNT(*) AS count FROM invoices WHERE payment_status = 'Unpaid'")
        unpaid_invoices = cursor.fetchone()['count']

        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not load dashboard stats.', 'details': str(error)}), 503

    stats = {
        'total_patients':     total_patients,
        'appointments_today': appointments_today,
        'revenue_today':      revenue_today,
        'unpaid_invoices':    unpaid_invoices
    }
    cache_set(cache_key, stats, ttl=60)
    return jsonify({'stats': stats, 'source': 'db'}), 200


@reports_bp.route('/analytics/weekly', methods=['GET'])
@login_required
def get_weekly_analytics():
    """Return a 7-day trend of appointments and revenue per day for charts."""
    cache_key = f'analytics:weekly:{date.today().isoformat()}'
    cached    = cache_get(cache_key)
    if cached:
        return jsonify({'weekly': cached, 'source': 'cache'}), 200

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)
        cursor.execute("""
            SELECT
                DATE(a.appointment_datetime) AS day,
                COUNT(*)                     AS total_appointments,
                SUM(a.status = 'Completed')  AS completed,
                SUM(a.status = 'Cancelled')  AS cancelled,
                COALESCE(SUM(p.amount_paid), 0) AS revenue
            FROM appointments a
            LEFT JOIN invoices  i ON a.appointment_id = i.appointment_id
            LEFT JOIN payments  p ON i.invoice_id     = p.invoice_id
                                  AND p.payment_date = DATE(a.appointment_datetime)
            WHERE a.appointment_datetime >= CURDATE() - INTERVAL 6 DAY
            GROUP BY DATE(a.appointment_datetime)
            ORDER BY day
        """)
        weekly = cursor.fetchall()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not load weekly analytics.', 'details': str(error)}), 503

    cache_set(cache_key, weekly, ttl=300)
    return jsonify({'weekly': weekly, 'source': 'db'}), 200


@reports_bp.route('/analytics/snapshots', methods=['GET'])
@login_required
def get_analytics_snapshots():
    """
    Return pre-aggregated daily snapshots from the analytics_snapshots table.
    These are computed once per day so this query is fast even on slow hardware.
    """
    limit     = min(int(request.args.get('limit', 30)), 90)
    cache_key = f'analytics:snapshots:{limit}'
    cached    = cache_get(cache_key)
    if cached:
        return jsonify({'snapshots': cached, 'source': 'cache'}), 200

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)
        cursor.execute("""
            SELECT snapshot_date, total_patients, total_appointments,
                   total_revenue, top_diagnosis, cancellation_rate, avg_wait_time_min
            FROM analytics_snapshots
            ORDER BY snapshot_date DESC
            LIMIT %s
        """, (limit,))
        snapshots = cursor.fetchall()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not load snapshots.', 'details': str(error)}), 503

    cache_set(cache_key, snapshots, ttl=600)
    return jsonify({'snapshots': snapshots, 'source': 'db'}), 200


@reports_bp.route('/reports/financial', methods=['GET'])
@role_required('admin')
def get_financial_report():
    """Return a financial summary for a date range. Usage: ?from=2025-06-01&to=2025-06-30"""
    date_from = request.args.get('from', date.today().replace(day=1).isoformat())
    date_to   = request.args.get('to',   date.today().isoformat())

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT COALESCE(SUM(amount_paid), 0) AS total_collected
            FROM payments
            WHERE payment_date BETWEEN %s AND %s
        """, (date_from, date_to))
        revenue = cursor.fetchone()

        cursor.execute("""
            SELECT payment_method, SUM(amount_paid) AS total, COUNT(*) AS transactions
            FROM payments
            WHERE payment_date BETWEEN %s AND %s
            GROUP BY payment_method
        """, (date_from, date_to))
        by_method = cursor.fetchall()

        cursor.execute("""
            SELECT payment_status, COUNT(*) AS count, SUM(amount_due) AS total_owed
            FROM invoices
            WHERE invoice_date BETWEEN %s AND %s
            GROUP BY payment_status
        """, (date_from, date_to))
        by_status = cursor.fetchall()

        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not generate financial report.', 'details': str(error)}), 503

    return jsonify({
        'period':          {'from': date_from, 'to': date_to},
        'total_collected': float(revenue['total_collected']),
        'by_method':       by_method,
        'by_status':       by_status
    }), 200


@reports_bp.route('/reports/clinical', methods=['GET'])
@role_required('admin', 'doctor')
def get_clinical_report():
    """Return top diagnoses and visit volume for a date range."""
    date_from = request.args.get('from', date.today().replace(day=1).isoformat())
    date_to   = request.args.get('to',   date.today().isoformat())

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT d.description, COUNT(*) AS frequency
            FROM diagnoses d
            JOIN medical_visits v ON d.visit_id = v.visit_id
            WHERE v.visit_date BETWEEN %s AND %s
            GROUP BY d.description
            ORDER BY frequency DESC
            LIMIT 10
        """, (date_from, date_to))
        top_diagnoses = cursor.fetchall()

        cursor.execute("""
            SELECT COUNT(*) AS total_visits FROM medical_visits
            WHERE visit_date BETWEEN %s AND %s
        """, (date_from, date_to))
        total_visits = cursor.fetchone()['total_visits']

        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not generate clinical report.', 'details': str(error)}), 503

    return jsonify({
        'period':        {'from': date_from, 'to': date_to},
        'total_visits':  total_visits,
        'top_diagnoses': top_diagnoses
    }), 200


@reports_bp.route('/reports/operational', methods=['GET'])
@role_required('admin')
def get_operational_report():
    """Return appointment completion rates and average wait times for a date range."""
    date_from = request.args.get('from', date.today().replace(day=1).isoformat())
    date_to   = request.args.get('to',   date.today().isoformat())

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT status, COUNT(*) AS count
            FROM appointments
            WHERE DATE(appointment_datetime) BETWEEN %s AND %s
            GROUP BY status
        """, (date_from, date_to))
        by_status = cursor.fetchall()

        cursor.execute("""
            SELECT AVG(avg_wait_time_min) AS avg_wait
            FROM analytics_snapshots
            WHERE snapshot_date BETWEEN %s AND %s
        """, (date_from, date_to))
        avg_wait = cursor.fetchone()

        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not generate operational report.', 'details': str(error)}), 503

    return jsonify({
        'period':                 {'from': date_from, 'to': date_to},
        'appointments_by_status': by_status,
        'avg_wait_time_minutes':  float(avg_wait['avg_wait'] or 0)
    }), 200
