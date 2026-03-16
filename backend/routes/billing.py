from flask import Blueprint, request, jsonify
from config import get_db_connection
from cache import cache_get, cache_set, cache_invalidate
from routes.auth import login_required, role_required

billing_bp = Blueprint('billing', __name__)


# route to get all billable services offered by the clinic
@billing_bp.route('/services', methods=['GET'])
@login_required
def get_services():
    """Returns the clinic's full catalogue of billable services."""
    cached = cache_get('services:all')
    if cached:
        return jsonify({'services': cached, 'source': 'cache'}), 200

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT service_id, service_name, description, unit_price, category
            FROM services
            ORDER BY category, service_name
        """)
        services = cursor.fetchall()
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not retrieve services.', 'details': str(e)}), 503

    cache_set('services:all', services, ttl=600)  # services rarely change — 10 min cache
    return jsonify({'services': services, 'source': 'db'}), 200


# route to list invoices, with optional filters for patient or payment status
@billing_bp.route('/invoices', methods=['GET'])
@login_required
def get_invoices():
    """List invoices. Optional filters: ?patient_id=1&status=Unpaid"""
    patient_id = request.args.get('patient_id')
    status     = request.args.get('status')

    cache_key = f'invoices:{patient_id}:{status}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify({'invoices': cached, 'source': 'cache'}), 200

    query  = """
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
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(query, params)
        invoices = cursor.fetchall()
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not retrieve invoices.', 'details': str(e)}), 503

    cache_set(cache_key, invoices)
    return jsonify({'invoices': invoices, 'source': 'db'}), 200


# route to get a single invoice with line-item details
@billing_bp.route('/invoices/<int:invoice_id>', methods=['GET'])
@login_required
def get_invoice(invoice_id):
    """Returns an invoice with its full line-item breakdown."""
    cache_key = f'invoices:detail:{invoice_id}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify({'invoice': cached, 'source': 'cache'}), 200

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT i.*, p.first_name, p.last_name, p.clinic_number
            FROM invoices i
            JOIN patients p ON i.patient_id = p.patient_id
            WHERE i.invoice_id = %s
        """, (invoice_id,))
        invoice = cursor.fetchone()

        if not invoice:
            conn.close()
            return jsonify({'error': 'Invoice not found'}), 404

        # Attach the line items
        cursor.execute("""
            SELECT ii.quantity, ii.unit_price, ii.subtotal,
                   s.service_name, s.category
            FROM invoice_items ii
            JOIN services s ON ii.service_id = s.service_id
            WHERE ii.invoice_id = %s
        """, (invoice_id,))
        invoice['items'] = cursor.fetchall()
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not retrieve invoice.', 'details': str(e)}), 503

    cache_set(cache_key, invoice)
    return jsonify({'invoice': invoice, 'source': 'db'}), 200


# route to create a new invoice with line items in one request
@billing_bp.route('/invoices', methods=['POST'])
@role_required('admin', 'receptionist')
def create_invoice():
    """
    Creates an invoice and its line items in one request.
    Expected body:
    {
        "patient_id": 1,
        "appointment_id": 3,          (optional)
        "discount": 1000,             (optional, default 0)
        "items": [
            { "service_id": 1, "quantity": 1 },
            { "service_id": 2, "quantity": 2 }
        ]
    }
    """
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    if not data.get('patient_id'):
        return jsonify({'error': 'patient_id is required'}), 400
    if not data.get('items') or len(data['items']) == 0:
        return jsonify({'error': 'At least one item is required'}), 400

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        # Look up the unit price for each service_id from the services table
        total = 0.0
        line_items = []
        for item in data['items']:
            cursor.execute("SELECT unit_price FROM services WHERE service_id = %s", (item['service_id'],))
            svc = cursor.fetchone()
            if not svc:
                conn.close()
                return jsonify({'error': f"Service ID {item['service_id']} not found"}), 400

            qty      = int(item.get('quantity', 1))
            price    = float(svc['unit_price'])
            subtotal = qty * price
            total   += subtotal
            line_items.append((item['service_id'], qty, price, subtotal))

        discount   = float(data.get('discount', 0))
        amount_due = total - discount

        # Insert the invoice header
        cursor = conn.cursor()
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

        # Insert each line item
        cursor.executemany("""
            INSERT INTO invoice_items (invoice_id, service_id, quantity, unit_price, subtotal)
            VALUES (%s, %s, %s, %s, %s)
        """, [(invoice_id, sid, qty, price, sub) for sid, qty, price, sub in line_items])

        conn.commit()
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Could not create invoice.', 'details': str(e)}), 503

    cache_invalidate('invoices')
    return jsonify({'invoice_id': invoice_id, 'total': total, 'amount_due': amount_due}), 201


# route to record a payment against an invoice
@billing_bp.route('/payments', methods=['POST'])
@role_required('admin', 'receptionist')
def record_payment():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['invoice_id', 'amount_paid', 'payment_date']
    missing  = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        # Check the invoice exists and get current balance
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
            conn.close()
            return jsonify({'error': 'Invoice not found'}), 404

        if invoice['payment_status'] == 'Paid':
            conn.close()
            return jsonify({'error': 'This invoice is already fully paid'}), 409

        # Record the payment
        cursor = conn.cursor()
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

        # Recalculate and update payment_status on the invoice
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
        conn.commit()
        conn.close()
    except Exception as e:
        return jsonify({'error': 'Payment recording failed.', 'details': str(e)}), 503

    cache_invalidate('invoices')
    return jsonify({'message': 'Payment recorded', 'new_status': new_status}), 201