from flask import Blueprint, request, jsonify, session
from config import get_db_connection, Config
import hashlib
import time

auth_bp = Blueprint('auth', __name__)


def hash_password(password):
    """Hash a plain-text password using SHA-256."""
    return hashlib.sha256(password.encode()).hexdigest()


def build_password_candidates(password):
    """
    Return all accepted hash variants for a given password.
    Supports both SHA-256 and MD5 (full and truncated) to handle
    legacy seeded test data alongside properly hashed passwords.
    """
    sha256_hash = hashlib.sha256(password.encode()).hexdigest()
    md5_hash    = hashlib.md5(password.encode()).hexdigest()
    return [
        sha256_hash,
        sha256_hash[:20],
        md5_hash,
        md5_hash[:20]
    ]


@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'error': 'Username and password are required'}), 400

    username            = data['username']
    password_candidates = build_password_candidates(data['password'])

    connection = None
    try:
        connection = get_db_connection()
        cursor     = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT user_id, username, role, fullname
            FROM users
            WHERE username = %s AND password IN (%s, %s, %s, %s)
        """, (username, *password_candidates))
        user = cursor.fetchone()

        if not user:
            return jsonify({'error': 'Invalid username or password'}), 401

        session['user_id']      = user['user_id']
        session['username']     = user['username']
        session['role']         = user['role']
        session['logged_in_at'] = time.time()

        # Look up the doctor_id for doctor-role users so it can be stored in session
        doctor_id = None
        if user['role'] == 'doctor':
            cursor.execute("""
                SELECT doctor_id FROM doctors
                WHERE full_name = %s LIMIT 1
            """, (user['fullname'],))
            doctor_row = cursor.fetchone()
            if doctor_row:
                doctor_id            = doctor_row['doctor_id']
                session['doctor_id'] = doctor_id

    except Exception as error:
        return jsonify({'error': 'Database unavailable. Please try again.', 'details': str(error)}), 503
    finally:
        if connection:
            try:
                connection.close()
            except Exception:
                pass

    return jsonify({
        'message':   'Login successful',
        'user':      {'username': user['username'], 'role': user['role']},
        'doctor_id': doctor_id
    }), 200


@auth_bp.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'message': 'Logged out successfully'}), 200


def login_required(function):
    """Decorator that blocks unauthenticated requests with a 401 response."""
    from functools import wraps

    @wraps(function)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Please log in to access this resource'}), 401

        elapsed_seconds = time.time() - session.get('logged_in_at', 0)
        if elapsed_seconds > Config.SESSION_LIFETIME:
            session.clear()
            return jsonify({'error': 'Session expired. Please log in again.'}), 401

        return function(*args, **kwargs)
    return decorated


def role_required(*allowed_roles):
    """Decorator that restricts a route to users with one of the specified roles."""
    from functools import wraps

    def decorator(function):
        @wraps(function)
        def decorated(*args, **kwargs):
            if 'user_id' not in session:
                return jsonify({'error': 'Please log in'}), 401
            if session.get('role') not in allowed_roles:
                return jsonify({'error': 'You do not have permission to access this resource'}), 403
            return function(*args, **kwargs)
        return decorated
    return decorator
