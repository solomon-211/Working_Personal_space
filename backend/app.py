from flask import Flask, jsonify
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

# Allow frontend (HTML/JS) to call the API from a different port or origin
CORS(app, 
     supports_credentials=True,
     origins=["http://127.0.0.1:5500", "http://localhost:5500"]
)

# Register all blueprints with the /api prefix
app.register_blueprint(auth_bp,          url_prefix='/api/auth')
app.register_blueprint(patients_bp,      url_prefix='/api')
app.register_blueprint(doctors_bp,       url_prefix='/api')
app.register_blueprint(appointments_bp,  url_prefix='/api')
app.register_blueprint(medical_visits_bp,url_prefix='/api')
app.register_blueprint(billing_bp,       url_prefix='/api')
app.register_blueprint(reports_bp,       url_prefix='/api')


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