import os
import sys
import datetime

# Ensure unbuffered output
os.environ["PYTHONUNBUFFERED"] = "1"

# 1. Print [boot] line with UTC timestamp, cwd, PORT, python executable
now_utc = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
cwd = os.getcwd()
port_val = os.environ.get("PORT")
port_str = port_val if port_val is not None else "unset"
print(f"[boot] {now_utc} cwd={cwd} PORT={port_str} python={sys.executable}", flush=True)

# 2. Print the NAMES only of environment variables matching target prefixes (values masked)
target_prefixes = ("GUNICORN", "WEB_CONCURRENCY", "PYTHON", "PORT", "RENDER")
matching_vars = sorted([
    k for k in os.environ.keys()
    if any(k.startswith(prefix) for prefix in target_prefixes)
])
print(f"[boot] Environment check ({len(matching_vars)} matching vars):", flush=True)
for var_name in matching_vars:
    print(f"  - {var_name}=[SET]", flush=True)

# 3. Check GUNICORN_CMD_ARGS and strip if present
if "GUNICORN_CMD_ARGS" in os.environ:
    cmd_args_val = os.environ["GUNICORN_CMD_ARGS"]
    print(
        f"[boot] WARNING: GUNICORN_CMD_ARGS is set in environment! Value: '{cmd_args_val}'.",
        flush=True,
    )
    print(
        "[boot] WARNING: Deleting GUNICORN_CMD_ARGS to prevent premature preload and ensure fast port binding.",
        flush=True,
    )
    del os.environ["GUNICORN_CMD_ARGS"]

# 4. Resolve absolute paths and change directory
base_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(base_dir)
conf_path = os.path.join(base_dir, "gunicorn.conf.py")

# 5. Exec gunicorn
if sys.platform == "win32":
    # On Windows development workstations, gunicorn cannot run due to missing POSIX fcntl/signals.
    # Provide a local multi-threaded WSGI server that executes the exact same hooks, port binding, and warm-up.
    import socketserver
    import importlib.util
    from wsgiref.simple_server import WSGIServer, WSGIRequestHandler, make_server

    print(f"[boot] Windows platform detected (sys.platform={sys.platform}).", flush=True)
    print("[boot] Running local threaded WSGI runner executing gunicorn.conf.py lifecycle hooks.", flush=True)

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "sehat_backend.settings")
    from sehat_backend.wsgi import application

    port = int(port_val or 10000)

    # Load gunicorn.conf.py
    spec = importlib.util.spec_from_file_location("gunicorn_conf", conf_path)
    gconf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gconf)

    class DummyServer:
        class Config:
            bind = [f"0.0.0.0:{port}"]
        cfg = Config()

    class DummyWorker:
        pid = os.getpid()

    # Trigger lifecycle hooks
    gconf.on_starting(DummyServer())

    class QuietWSGIRequestHandler(WSGIRequestHandler):
        def log_message(self, format, *args):
            # Keep stdout clean; access logs are handled if needed
            pass

    class ThreadedWSGIServer(socketserver.ThreadingMixIn, WSGIServer):
        daemon_threads = True

    httpd = make_server("0.0.0.0", port, application, server_class=ThreadedWSGIServer, handler_class=QuietWSGIRequestHandler)
    gconf.when_ready(DummyServer())
    gconf.post_worker_init(DummyWorker())

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        gconf.worker_exit(DummyServer(), DummyWorker())
        sys.exit(0)
else:
    # On Linux (Render Production): use os.execv to run gunicorn directly
    cmd = [
        sys.executable,
        "-m",
        "gunicorn",
        "-c",
        conf_path,
        "sehat_backend.wsgi"
    ]
    os.execv(sys.executable, cmd)
