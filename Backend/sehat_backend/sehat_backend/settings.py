import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from decouple import config
import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables
load_dotenv(BASE_DIR / '.env')
load_dotenv()

SECRET_KEY = config('SECRET_KEY', default='django-insecure-temp-key-change-in-production')

DJANGO_DEBUG = os.getenv('DJANGO_DEBUG', 'False')
DEBUG = DJANGO_DEBUG.lower() in ('true', '1', 't')

RUNNING_DEV_SERVER = any('runserver' in arg for arg in sys.argv)


class _LocalIPAllowedHosts(list):
    """ALLOWED_HOSTS that also admits this machine's current IPv4 addresses.

    Re-resolved (with a short cache) on every host check, so the dev server keeps
    working when the Wi-Fi/LAN IP changes, without editing .env or restarting.
    """
    _TTL_SECONDS = 10

    def __init__(self, hosts):
        super().__init__(hosts)
        self._cached_ips = []
        self._cached_at = 0.0

    def _local_ips(self):
        import socket
        import time
        now = time.monotonic()
        if now - self._cached_at < self._TTL_SECONDS:
            return self._cached_ips
        ips = set()
        try:
            ips.update(socket.gethostbyname_ex(socket.gethostname())[2])
        except OSError:
            pass
        try:
            # Primary outbound interface; UDP connect sends no packets
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(('8.8.8.8', 80))
                ips.add(s.getsockname()[0])
        except OSError:
            pass
        self._cached_ips = sorted(ips)
        self._cached_at = now
        return self._cached_ips

    def __iter__(self):
        yield from super().__iter__()
        yield from self._local_ips()


ALLOWED_HOSTS = [host.strip() for host in os.getenv('ALLOWED_HOSTS', '').split(',') if host.strip()]
if not ALLOWED_HOSTS and RUNNING_DEV_SERVER:
    ALLOWED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '*']
elif RUNNING_DEV_SERVER:
    ALLOWED_HOSTS = _LocalIPAllowedHosts(ALLOWED_HOSTS)

# Applications
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    
    # Third party
    'rest_framework',
    'corsheaders',
    
    # Local apps
    'chat',
    
]

MIDDLEWARE = [
    'sehat_backend.health_middleware.HealthCheckMiddleware',  # First: immediate /healthz and /readyz
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'sehat_backend.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'sehat_backend.wsgi.application'

# Database: SQLite in-memory for tests, PostgreSQL (Neon) at runtime
if 'test' in sys.argv:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': ':memory:',
        }
    }
else:
    DATABASES = {
        'default': dj_database_url.config(
            default=os.getenv("DATABASE_URL"),
            conn_max_age=600,
            conn_health_checks=True,  # Neon drops idle connections; re-check before reuse
        ) or {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': config('DB_NAME', default='sehat'),
            'USER': config('DB_USER', default='postgres'),
            'PASSWORD': config('DB_PASSWORD', default='12345'),
            'HOST': config('DB_HOST', default='localhost'),
            'PORT': config('DB_PORT', default='5432'),
        }
    }

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Karachi'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# CORS Settings (React Native & Web)
CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True

# REST Framework Settings
REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.LimitOffsetPagination',
    'PAGE_SIZE': 20,
}

# Logging Configuration
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'standard': {
            'format': '%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'standard',
        },
    },
    'loggers': {
        'chat': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}
