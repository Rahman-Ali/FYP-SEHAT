import os
import sys
import time

bind = "0.0.0.0:" + (os.environ.get("PORT") or "10000")
workers = 1
worker_class = "gthread"
threads = 4
timeout = 300
graceful_timeout = 30
preload_app = False
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("GUNICORN_LOGLEVEL") or "info"
capture_output = True

_master_start_time = time.time()


def on_starting(server):
    print(f"[gunicorn] master starting (pid={os.getpid()})", flush=True)


def when_ready(server):
    b = server.cfg.bind[0] if isinstance(server.cfg.bind, list) else str(server.cfg.bind)
    print(f"[gunicorn] READY, listening on {b}", flush=True)


def post_worker_init(worker):
    elapsed = time.time() - _master_start_time
    print(f"[gunicorn] worker {worker.pid} app loaded after {elapsed:.2f}s", flush=True)
    try:
        from chat.warmup import start_warmup
        start_warmup()
    except Exception as e:
        print(f"[gunicorn] ERROR: Failed to start background warm-up: {e}", flush=True)


def worker_abort(worker):
    print(f"[gunicorn] worker {worker.pid} aborted", flush=True)


def worker_exit(server, worker):
    print(f"[gunicorn] worker {worker.pid} exited", flush=True)
