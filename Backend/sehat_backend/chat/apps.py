import os
import sys
from django.apps import AppConfig


class ChatConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'chat'

    def ready(self):
        from .services import initialize_firebase_admin
        initialize_firebase_admin()

        # Do not start background warm-up during management commands or tests
        skip_commands = {'migrate', 'makemigrations', 'collectstatic', 'test', 'check', 'shell', 'ingest_documents'}
        if any(cmd in sys.argv for cmd in skip_commands):
            return

        # When running runserver, only start in the reloader's main execution process
        if 'runserver' in sys.argv and os.environ.get('RUN_MAIN') != 'true':
            return

        from .warmup import start_warmup
        start_warmup()
