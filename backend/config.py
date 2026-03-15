import os


def load_dotenv(dotenv_path):
    """Load simple KEY=VALUE pairs from a .env file into process env."""
    if not os.path.exists(dotenv_path):
        return

    with open(dotenv_path, 'r', encoding='utf-8') as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue

            key, value = line.split('=', 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, '.env'))

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'healthbridge-dev-secret-key')

    DB_HOST     = os.environ.get('DB_HOST',     'localhost')
    DB_PORT     = int(os.environ.get('DB_PORT', 3306))
    DB_USER     = os.environ.get('DB_USER',     'root')
    DB_PASSWORD = os.environ.get('DB_PASSWORD', '')
    DB_NAME     = os.environ.get('DB_NAME',     'healthbridge_db')

    
    SESSION_LIFETIME = int(os.environ.get('SESSION_LIFETIME', 3600)) # 1 hour default. After this, users must log in again. Reduces risk of stolen sessions.

    CACHE_TTL = int(os.environ.get('CACHE_TTL', 30))


def get_db_connection():
    # create and return a new DB connection.
    import mysql.connector
    conn = mysql.connector.connect(
        host        = Config.DB_HOST,
        port        = Config.DB_PORT,
        user        = Config.DB_USER,
        password    = Config.DB_PASSWORD,
        database    = Config.DB_NAME,
        connect_timeout = 10       # fail fast on bad network instead of hanging
    )
    return conn
