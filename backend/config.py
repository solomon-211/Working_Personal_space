import os


def _load_env_file() -> None:
    """Load backend/.env so DB credentials are available in all entrypoints."""
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    if not os.path.exists(env_path):
        return

    # Prefer python-dotenv when available.
    try:
        import importlib
        dotenv = importlib.import_module('dotenv')
        load_dotenv = getattr(dotenv, 'load_dotenv', None)
        if callable(load_dotenv):
            load_dotenv(env_path)
            return
    except Exception:
        pass

    # Fallback parser when python-dotenv is unavailable.
    try:
        with open(env_path, 'r', encoding='utf-8') as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, value = line.split('=', 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ.setdefault(key, value)
    except Exception:
        # Keep defaults from Config if file parsing fails.
        pass


_load_env_file()

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
