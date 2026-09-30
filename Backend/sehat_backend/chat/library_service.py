# backend/chat/library_service.py
"""Reference-book library: documents list (Neo4j joined with medical_documents/), doc ids and signed file links."""
import hashlib
import logging
import os
import threading
import time
from pathlib import Path

from django.conf import settings
from django.core import signing

logger = logging.getLogger(__name__)

MEDICAL_DOCS_DIR = Path(settings.BASE_DIR).parent / "medical_documents"
LINK_SALT = "sehat.library.file"
LINK_MAX_AGE_SECONDS = 600
CACHE_TTL_SECONDS = 300
GENERAL_DISEASE = "general"

_cache_lock = threading.Lock()
_cache = {"at": 0.0, "library": None, "by_id": {}}
_page_counts = {}  # (source_file, mtime, size) -> page count


def doc_id_for(source_file: str) -> str:
    """Stable, opaque id for a book (never the file name or path)."""
    return hashlib.sha256(f"sehat-library:{source_file}".encode("utf-8")).hexdigest()[:20]


def disease_label(tag: str) -> str:
    tag = (tag or GENERAL_DISEASE).strip()
    if len(tag) <= 3:
        return tag.upper()
    return tag.replace("_", " ").title()


def clear_cache():
    """Called after admin add/remove so the next request rebuilds the list."""
    with _cache_lock:
        _cache.update(at=0.0, library=None, by_id={})


def _is_downloadable(source_file: str) -> bool:
    policy = getattr(settings, "LIBRARY_DOWNLOADABLE", {}) or {}
    return bool(policy.get(source_file, True))


def _pdf_page_count(path: Path, source_file: str, fallback: int) -> int:
    try:
        st = path.stat()
        key = (source_file, st.st_mtime, st.st_size)
        if key not in _page_counts:
            from pypdf import PdfReader
            _page_counts[key] = len(PdfReader(str(path)).pages)
        return _page_counts[key]
    except Exception as e:
        logger.warning("[LIBRARY] page count failed for a book (%s); using index data", e.__class__.__name__)
        return fallback


def _disk_files() -> dict:
    files = {}
    if MEDICAL_DOCS_DIR.is_dir():
        for entry in os.scandir(MEDICAL_DOCS_DIR):
            if entry.is_file() and entry.name.lower().endswith(".pdf"):
                files[entry.name] = Path(entry.path)
    return files


def _neo4j_books() -> list:
    from neo4j import GraphDatabase
    from .vector_store_service import VectorStoreService

    vs = VectorStoreService()  # reads connection settings only (no models, no data written)
    driver = GraphDatabase.driver(vs.NEO4J_URI, auth=(vs.NEO4J_USERNAME, vs.NEO4J_PASSWORD))
    try:
        with driver.session(database=vs.NEO4J_DATABASE) as session:
            return session.run(
                "MATCH (n:MedicalDocument) WHERE n.source_file IS NOT NULL "
                "RETURN n.source_file AS source_file, head(collect(DISTINCT n.disease)) AS disease, "
                "head(collect(DISTINCT n.display_title)) AS title, max(n.page) AS max_page"
            ).data()
    finally:
        driver.close()


def _build() -> tuple:
    disk = _disk_files()
    by_disease, by_id = {}, {}
    for row in _neo4j_books():
        source_file = row.get("source_file")
        path = disk.get(source_file)
        if not source_file or path is None:
            continue  # indexed but the file is gone: nothing to read
        disease = (row.get("disease") or GENERAL_DISEASE).strip() or GENERAL_DISEASE
        max_page = row.get("max_page")
        fallback_pages = int(max_page) + 1 if isinstance(max_page, (int, float)) else 0
        doc = {
            "doc_id": doc_id_for(source_file),
            "title": row.get("title") or os.path.splitext(source_file)[0],
            "disease": disease,
            "pages": _pdf_page_count(path, source_file, fallback_pages),
            "size_mb": round(path.stat().st_size / (1024 * 1024), 2),
            "downloadable": _is_downloadable(source_file),
        }
        by_disease.setdefault(disease, []).append(doc)
        by_id[doc["doc_id"]] = {"source_file": source_file, "doc": doc}

    diseases = [
        {
            "disease": tag,
            "label": disease_label(tag),
            "documents": sorted(docs, key=lambda d: d["title"].lower()),
        }
        for tag, docs in sorted(by_disease.items(), key=lambda kv: (kv[0] == GENERAL_DISEASE, kv[0]))
    ]
    library = {"diseases": diseases, "count": len(by_id), "generated_at": int(time.time())}
    return library, by_id


def get_library(force: bool = False) -> dict:
    with _cache_lock:
        fresh = _cache["library"] is not None and time.time() - _cache["at"] < CACHE_TTL_SECONDS
        if fresh and not force:
            return _cache["library"]
    library, by_id = _build()
    with _cache_lock:
        _cache.update(at=time.time(), library=library, by_id=by_id)
    return library


def resolve(doc_id: str):
    """(absolute path, doc dict) for a doc id, or None. Only files directly inside medical_documents/."""
    if not doc_id or len(doc_id) != 20 or not all(c in "0123456789abcdef" for c in doc_id):
        return None
    get_library()
    with _cache_lock:
        entry = _cache["by_id"].get(doc_id)
    if entry is None:
        return None
    base = MEDICAL_DOCS_DIR.resolve()
    path = (base / entry["source_file"]).resolve()
    if path.parent != base or not path.is_file():
        return None
    return path, entry["doc"]


def _signer():
    # "." separator: the token goes in a URL path, and ":" / "|" are not path-safe everywhere
    return signing.TimestampSigner(salt=LINK_SALT, sep=".")


def sign_link(doc_id: str, purpose: str) -> str:
    return _signer().sign_object({"d": doc_id, "p": purpose}, compress=False)


def unsign_link(token: str) -> dict:
    """Raises signing.SignatureExpired (subclass of BadSignature) or signing.BadSignature."""
    data = _signer().unsign_object(token, max_age=LINK_MAX_AGE_SECONDS)
    if not isinstance(data, dict) or "d" not in data or data.get("p") not in ("read", "download"):
        raise signing.BadSignature("bad payload")
    return data
