import os
import sys
import time
import threading
import logging

logger = logging.getLogger("chat.warmup")

_state = "idle"
_error_class = None
_lock = threading.Lock()
_started = False


def _get_vm_rss_kb():
    """Read VmRSS in KB from /proc/self/status on Linux; returns None on Windows."""
    try:
        if os.path.exists("/proc/self/status"):
            with open("/proc/self/status", "r") as f:
                for line in f:
                    if line.startswith("VmRSS:"):
                        parts = line.split()
                        if len(parts) >= 2:
                            return int(parts[1])
    except Exception:
        pass
    return None


def _format_rss():
    rss_kb = _get_vm_rss_kb()
    if rss_kb is not None:
        return f"RSS={rss_kb / 1024:.1f}MB"
    return "RSS=N/A"


def get_warmup_state() -> str:
    """Return current warm-up state: 'idle', 'loading', 'ready', or 'failed'."""
    with _lock:
        return _state


def get_warmup_error() -> str | None:
    """Return error class name if warm-up failed, else None."""
    with _lock:
        return _error_class


def _run_warmup():
    global _state, _error_class
    with _lock:
        _state = "loading"
        _error_class = None

    start_total = time.time()
    print(f"[warmup] Background warm-up started ({_format_rss()})", flush=True)

    try:
        # Step 1: Resolve Neo4j DB name (read-only)
        s1 = time.time()
        db_name = os.getenv("NEO4J_DATABASE")
        if not db_name:
            uri = os.getenv("NEO4J_URI", "")
            username = os.getenv("NEO4J_USERNAME")
            password = os.getenv("NEO4J_PASSWORD")
            if uri and username and password:
                from neo4j import GraphDatabase
                try:
                    driver = GraphDatabase.driver(uri, auth=(username, password))
                    with driver.session() as session:
                        rec = session.run("SHOW DEFAULT DATABASE YIELD name RETURN name").single()
                        if rec:
                            db_name = rec["name"]
                    driver.close()
                except Exception as probe_err:
                    logger.warning(f"Neo4j database auto-detect failed: {probe_err}")
            if not db_name:
                db_name = "neo4j"
            os.environ["NEO4J_DATABASE"] = db_name

        print(
            f"[warmup] Step 1: Neo4j DB resolved to '{db_name}' in {time.time() - s1:.2f}s ({_format_rss()})",
            flush=True,
        )

        # Step 2: Load embedding model
        s2 = time.time()
        from .services import get_chat_service
        chat_svc = get_chat_service()
        vec_svc = chat_svc.rag_service.vector_service
        vec_svc.load_models()
        print(
            f"[warmup] Step 2: Embedding models loaded in {time.time() - s2:.2f}s ({_format_rss()})",
            flush=True,
        )

        # Step 3: Build BM25 from Neo4j (read-only)
        s3 = time.time()
        vec_svc.warm_up_bm25_from_neo4j()
        print(
            f"[warmup] Step 3: BM25 index built in {time.time() - s3:.2f}s ({_format_rss()})",
            flush=True,
        )

        # Step 4: Attach vector index (read-only)
        s4 = time.time()
        vec_svc.attach_vector_index()
        print(
            f"[warmup] Step 4: Vector index attached in {time.time() - s4:.2f}s ({_format_rss()})",
            flush=True,
        )

        vec_svc.is_ready = True
        total_time = time.time() - start_total
        with _lock:
            _state = "ready"
        print(
            f"[warmup] SUCCESS: Warm-up completed in {total_time:.2f}s ({_format_rss()})",
            flush=True,
        )

    except Exception as e:
        err_cls = e.__class__.__name__
        with _lock:
            _state = "failed"
            _error_class = err_cls
        print(
            f"[warmup] FAILED: Warm-up failed ({err_cls}): {e} ({_format_rss()})",
            flush=True,
        )


def start_warmup():
    """Start the warm-up background daemon thread once per process/worker."""
    global _started
    with _lock:
        if _started:
            return
        _started = True

    thread = threading.Thread(target=_run_warmup, daemon=True, name="sehat-warmup-worker")
    thread.start()
