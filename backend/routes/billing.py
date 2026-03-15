from flask import Blueprint, request, jsonify
from config import get_db_connection
from cache import cache_get, cache_set, cache_invalidate
from routes.auth import login_required, role_required

billing_bp = Blueprint('billing', __name__)


@billing_bp.route('/services', methods=['GET'])
@login_required
def get_services():
    """Return the clinic's full catalogue of billable services."""
    cached = cache_get('services:all')
    if cached:
        return jsonify({'services': cached, 'source': 'cache'}), 200

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)
        cursor.execute("""
            SELECT service_id, service_name, description, unit_price, category
            FROM services
            ORDER BY category, service_name
        """)
        services = cursor.fetchall()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not retrieve services.', 'details': str(error)}), 503

    # Services change rarely so a 10-minute cache is appropriate
    cache_set('services:all', services, ttl=600)
    return jsonify({'services': services, 'source': 'db'}), 200


@billing_bp.route('/invoices', methods=['GET'])
@login_required
def get_invoices():
    """Return invoices with optional filters: ?patient_id=1&status=Unpaid"""
    patient_id = request.args.get('patient_id')
    status     = request.args.get('status')

    cache_key = f'invoices:{patient_id}:{status}'
    cached    = cache_get(cache_key)
    if cached:
        return jsonify({'invoices': cached, 'source': 'cache'}), 200

    query = """
        SELECT i.invoice_id, i.invoice_date, i.total_amount,
               i.discount, i.amount_due, i.payment_status,
               p.first_name, p.last_name, p.clinic_number
        FROM invoices i
        JOIN patients p ON i.patient_id = p.patient_id
        WHERE 1=1
    """
    params = []

    if patient_id:
        query += " AND i.patient_id = %s"
        params.append(patient_id)
    if status:
        query += " AND i.payment_status = %s"
        params.append(status)

    query += " ORDER BY i.invoice_date DESC"

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)
        cursor.execute(query, params)
        invoices = cursor.fetchall()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not retrieve invoices.', 'details': str(error)}), 503

    cache_set(cache_key, invoices)
    return jsonify({'invoices': invoices, 'source': 'db'}), 200


@billing_bp.route('/invoices/<int:invoice_id>', methods=['GET'])
@login_required
def get_invoice(invoice_id):
    """Return a single invoice with its line items and payment history."""
    cache_key = f'invoices:detail:{invoice_id}'
    cached    = cache_get(cache_key)
    if cached:
        return jsonify({'invoice': cached, 'source': 'cache'}), 200

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT i.*, p.first_name, p.last_name, p.clinic_number
            FROM invoices i
            JOIN patients p ON i.patient_id = p.patient_id
            WHERE i.invoice_id = %s
        """, (invoice_id,))
        invoice = cursor.fetchone()

        if not invoice:
            connection.close()
            return jsonify({'error': 'Invoice not found'}), 404

        cursor.execute("""
            SELECT ii.quantity, ii.unit_price, ii.subtotal,
                   s.service_name, s.category
            FROM invoice_items ii
            JOIN services s ON ii.service_id = s.service_id
            WHERE ii.invoice_id = %s
        """, (invoice_id,))
        invoice['items'] = cursor.fetchall()

        cursor.execute("""
            SELECT payment_id, payment_date, amount_paid, payment_method, reference_no, received_by
            FROM payments
            WHERE invoice_id = %s
            ORDER BY payment_date ASC
        """, (invoice_id,))
        invoice['payments'] = cursor.fetchall()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not retrieve invoice.', 'details': str(error)}), 503

    cache_set(cache_key, invoice)
    return jsonify({'invoice': invoice, 'source': 'db'}), 200


@billing_bp.route('/invoices/from-visit', methods=['POST'])
@role_required('admin', 'receptionist')
def create_invoice_from_visit():
    """
    Create an invoice linked to a completed visit.
    Accepts free-text item names so prescription drugs not in the services
    catalogue can still be billed. A service row is auto-created if needed.
    Body: { patient_id, visit_id, discount, items: [{service_name, quantity, unit_price}] }
    """
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    if not data.get('patient_id'):
        return jsonify({'error': 'patient_id is required'}), 400
    if not data.get('items'):
        return jsonify({'error': 'At least one item is required'}), 400

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)

        # Resolve the appointment linked to this visit, if any
        appointment_id = None
        if data.get('visit_id'):
            cursor.execute(
                'SELECT appointment_id FROM medical_visits WHERE visit_id = %s',
                (data['visit_id'],)
            )
            visit_row = cursor.fetchone()
            if visit_row:
                appointment_id = visit_row['appointment_id']

        total      = 0.0
        line_items = []
        for item in data['items']:
            quantity = int(item.get('quantity', 1))
            price    = float(item.get('unit_price', 0))
            subtotal = quantity * price
            total   += subtotal
            line_items.append((item['service_name'], quantity, price, subtotal))

        discount   = float(data.get('discount', 0))
        amount_due = max(0.0, total - discount)

        cursor = connection.cursor()
        cursor.execute("""
            INSERT INTO invoices (patient_id, appointment_id, invoice_date,
                                  total_amount, discount, amount_due, payment_status)
            VALUES (%s, %s, CURDATE(), %s, %s, %s, 'Unpaid')
        """, (data['patient_id'], appointment_id, total, discount, amount_due))
        invoice_id = cursor.lastrowid

        for service_name, quantity, price, subtotal in line_items:
            lookup_cursor = connection.cursor(dictionary=True)
            lookup_cursor.execute(
                'SELECT service_id FROM services WHERE service_name = %s LIMIT 1',
                (service_name,)
            )
            existing_service = lookup_cursor.fetchone()

            if existing_service:
                service_id = existing_service['service_id']
            else:
                # Auto-create a service entry to satisfy the foreign key constraint
                lookup_cursor.execute("""
                    INSERT INTO services (service_name, description, unit_price, category)
                    VALUES (%s, 'Auto-created from consultation', %s, 'Medication')
                """, (service_name, price))
                service_id = lookup_cursor.lastrowid

            cursor.execute("""
                INSERT INTO invoice_items (invoice_id, service_id, quantity, unit_price, subtotal)
                VALUES (%s, %s, %s, %s, %s)
            """, (invoice_id, service_id, quantity, price, subtotal))

        connection.commit()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not create invoice.', 'details': str(error)}), 503

    cache_invalidate('invoices')
    return jsonify({'invoice_id': invoice_id, 'total': total, 'amount_due': amount_due}), 201


@billing_bp.route('/invoices', methods=['POST'])
@role_required('admin', 'receptionist')
def create_invoice():
    """
    Create an invoice with line items in a single request.
    Body: { patient_id, appointment_id (optional), discount (optional),
            items: [{ service_id, quantity }] }
    """
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    if not data.get('patient_id'):
        return jsonify({'error': 'patient_id is required'}), 400
    if not data.get('items'):
        return jsonify({'error': 'At least one item is required'}), 400

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)

        total      = 0.0
        line_items = []
        for item in data['items']:
            cursor.execute("SELECT unit_price FROM services WHERE service_id = %s", (item['service_id'],))
            service = cursor.fetchone()
            if not service:
                connection.close()
                return jsonify({'error': f"Service ID {item['service_id']} not found"}), 400

            quantity = int(item.get('quantity', 1))
            price    = float(service['unit_price'])
            subtotal = quantity * price
            total   += subtotal
            line_items.append((item['service_id'], quantity, price, subtotal))

        discount   = float(data.get('discount', 0))
        amount_due = total - discount

        cursor = connection.cursor()
        cursor.execute("""
            INSERT INTO invoices (patient_id, appointment_id, invoice_date,
                                  total_amount, discount, amount_due, payment_status)
            VALUES (%s, %s, CURDATE(), %s, %s, %s, 'Unpaid')
        """, (
            data['patient_id'],
            data.get('appointment_id'),
            total, discount, amount_due
        ))
        invoice_id = cursor.lastrowid

        cursor.executemany("""
            INSERT INTO invoice_items (invoice_id, service_id, quantity, unit_price, subtotal)
            VALUES (%s, %s, %s, %s, %s)
        """, [(invoice_id, service_id, qty, price, sub) for service_id, qty, price, sub in line_items])

        connection.commit()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Could not create invoice.', 'details': str(error)}), 503

    cache_invalidate('invoices')
    return jsonify({'invoice_id': invoice_id, 'total': total, 'amount_due': amount_due}), 201


@billing_bp.route('/payments', methods=['POST'])
@role_required('admin', 'receptionist')
def record_payment():
    """Record a payment against an invoice and update its payment status."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['invoice_id', 'amount_paid', 'payment_date']
    missing  = [field for field in required if not data.get(field)]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT amount_due, payment_status,
                   COALESCE(SUM(p.amount_paid), 0) AS already_paid
            FROM invoices i
            LEFT JOIN payments p ON i.invoice_id = p.invoice_id
            WHERE i.invoice_id = %s
            GROUP BY i.invoice_id
        """, (data['invoice_id'],))
        invoice = cursor.fetchone()

        if not invoice:
            connection.close()
            return jsonify({'error': 'Invoice not found'}), 404

        if invoice['payment_status'] == 'Paid':
            connection.close()
            return jsonify({'error': 'This invoice is already fully paid'}), 409

        cursor = connection.cursor()
        cursor.execute("""
            INSERT INTO payments (invoice_id, payment_date, amount_paid, payment_method, reference_no, received_by)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (
            data['invoice_id'],
            data['payment_date'],
            data['amount_paid'],
            data.get('payment_method', 'Cash'),
            data.get('reference_no', ''),
            data.get('received_by', '')
        ))

        total_paid = float(invoice['already_paid']) + float(data['amount_paid'])
        if total_paid >= float(invoice['amount_due']):
            new_status = 'Paid'
        elif total_paid > 0:
            new_status = 'Partial'
        else:
            new_status = 'Unpaid'

        cursor.execute(
            "UPDATE invoices SET payment_status = %s WHERE invoice_id = %s",
            (new_status, data['invoice_id'])
        )
        connection.commit()
        connection.close()
    except Exception as error:
        return jsonify({'error': 'Payment recording failed.', 'details': str(error)}), 503

    cache_invalidate('invoices')
    return jsonify({'message': 'Payment recorded', 'new_status': new_status}), 201
