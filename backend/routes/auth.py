from flask import Blueprint, request, jsonify, session
from config import get_db_connection, Config
import hashlib
import time 


# initializes the Flask Blueprint for the authentication route.
auth_bp = Blueprint('auth', __name__)

# to encode passwords from plain text to a SHA-256 hash.
def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

# handles POST requests to the /api/auth/login endpoint, allowing users to log in by providing their username and password. It checks the credentials against the database and, if valid, stores user information in the session.
@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'error': 'Username and password are required'}), 400

    username = data['username']
    password = hash_password(data['password'])

    try:
        conn   = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(
            "SELECT user_id, username, role FROM users WHERE username = %s AND password = %s",
            (username, password)
        )
        user = cursor.fetchone()
        conn.close()
    except Exception as e:
        # If the DB is unreachable, returns this message 
        return jsonify({'error': 'Database unavailable. Please try again.', 'details': str(e)}), 503

    if not user:
        return jsonify({'error': 'Invalid username or password'}), 401

    # Store user info in the server-side session
    session['user_id']   = user['user_id']
    session['username']  = user['username']
    session['role']      = user['role']
    session['logged_in_at'] = time.time()

    return jsonify({
        'message':  'Login successful',
        'user':     {'username': user['username'], 'role': user['role']}
    }), 200


# handles POST requests to the /api/auth/logout endpoint, allowing users to log out by clearing their session data.
@auth_bp.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'message': 'Logged out successfully'}), 200


# a decorator function that can be applied to routes to ensure that only logged-in users can access them. It checks if the user is logged in and if their session has expired, returning appropriate error 401 messages if access is denied.
def login_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Please log in to access this resource'}), 401

        # Auto-expire session after SESSION_LIFETIME seconds
        elapsed = time.time() - session.get('logged_in_at', 0)
        if elapsed > Config.SESSION_LIFETIME:
            session.clear()
            return jsonify({'error': 'Session expired. Please log in again.'}), 401

        return f(*args, **kwargs)
    return decorated

# a decorator function that can be applied to routes to restrict access based on user roles (e.g., 'admin', 'doctor'). It checks if the user is logged in and if their role is in the allowed roles, returning appropriate error messages if access is denied.
def role_required(*allowed_roles):
    from functools import wraps
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if 'user_id' not in session:
                return jsonify({'error': 'Please log in'}), 401
            if session.get('role') not in allowed_roles:
                return jsonify({'error': 'You do not have permission to access this resource'}), 403
            return f(*args, **kwargs)
        return decorated
    return decorator