import os
import importlib


def _optional_load_dotenv() -> None:
    try:
        dotenv = importlib.import_module('dotenv')
        load_dotenv = getattr(dotenv, 'load_dotenv', None)
        if callable(load_dotenv):
            load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
    except Exception:
        pass

_optional_load_dotenv()

from flask import Flask, jsonify, send_from_directory, redirect
from flask_cors import CORS
from config import Config

# Import all route blueprints
from routes.auth import auth_bp
from routes.patients import patients_bp
from routes.doctors import doctors_bp
from routes.appointments import appointments_bp
from routes.medical_visits import medical_visits_bp
from routes.billing import billing_bp
from routes.reports import reports_bp

app = Flask(__name__)
app.config.from_object(Config)

# Allow frontend (HTML/JS) to call the API from a different port or origin.
# supports_credentials=True is required so that the session cookie is accepted
# on cross-origin requests (apiFetch always sends credentials: 'include').
CORS(app, supports_credentials=True)

# Session cookie settings — keep the cookie accessible on the same site;
# set Secure=False for local HTTP development.
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE']   = False
app.config['SESSION_COOKIE_HTTPONLY']  = True

# Resolve the frontend folder (one level up from this file, then into frontend/)
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend')

# Register all blueprints with the /api prefix
app.register_blueprint(auth_bp,          url_prefix='/api/auth')
app.register_blueprint(patients_bp,      url_prefix='/api')
app.register_blueprint(doctors_bp,       url_prefix='/api')
app.register_blueprint(appointments_bp,  url_prefix='/api')
app.register_blueprint(medical_visits_bp,url_prefix='/api')
app.register_blueprint(billing_bp,       url_prefix='/api')
app.register_blueprint(reports_bp,       url_prefix='/api')


# ── Frontend static-file serving ─────────────────────────────────────────────
# Serve the entire frontend folder from Flask so that root-path URLs
# like /dashboard/index.html, /assets/css/style.css, etc. all resolve correctly.

@app.route('/')
def serve_index():
    return redirect('/auth/login.html')

@app.route('/<path:filename>')
def serve_frontend(filename):
    return send_from_directory(FRONTEND_DIR, filename)


# Global error handlers
# These catch unhandled errors so the API always returns clean JSON, even if something unexpected happens.

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Resource not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': 'Internal server error', 'details': str(e)}), 500


if __name__ == '__main__':
    # debug=True gives helpful error tracebacks during development
    app.run(debug=True, port=5000)