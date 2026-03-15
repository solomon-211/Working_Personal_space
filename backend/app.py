from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from config import Config
import os

from routes.auth import auth_bp
from routes.patients import patients_bp
from routes.doctors import doctors_bp
from routes.appointments import appointments_bp
from routes.medical_visits import medical_visits_bp
from routes.billing import billing_bp
from routes.reports import reports_bp
from routes.dashboard import dashboard_bp
from routes.prescriptions import prescriptions_bp
from routes.diagnoses import diagnoses_bp

app = Flask(__name__)
app.config.from_object(Config)
app.secret_key = Config.SECRET_KEY
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_HTTPONLY'] = True

# Allow the frontend served on a different port to make credentialed API calls
CORS(app, supports_credentials=True)

app.register_blueprint(auth_bp,           url_prefix='/api/auth')
app.register_blueprint(patients_bp,       url_prefix='/api')
app.register_blueprint(doctors_bp,        url_prefix='/api')
app.register_blueprint(appointments_bp,   url_prefix='/api')
app.register_blueprint(medical_visits_bp, url_prefix='/api')
app.register_blueprint(billing_bp,        url_prefix='/api')
app.register_blueprint(reports_bp,        url_prefix='/api')
app.register_blueprint(dashboard_bp,      url_prefix='/api')
app.register_blueprint(prescriptions_bp,  url_prefix='/api')
app.register_blueprint(diagnoses_bp,      url_prefix='/api')

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend'))


@app.route('/')
def index():
    return send_from_directory(os.path.join(FRONTEND_DIR, 'auth'), 'login.html')


@app.route('/<path:filename>')
def serve_frontend(filename):
    return send_from_directory(FRONTEND_DIR, filename)


@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Resource not found'}), 404


@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405


@app.errorhandler(500)
def server_error(error):
    return jsonify({'error': 'Internal server error', 'details': str(error)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)
