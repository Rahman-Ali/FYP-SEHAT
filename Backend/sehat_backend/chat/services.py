import os
import json
import time
import logging
import threading
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import auth, credentials

from .models import ChatSession, Message

load_dotenv()
logger = logging.getLogger(__name__)

_firebase_initialized = False


def initialize_firebase_admin():
    """Confirm firebase_admin is initialized once at startup using env configuration."""
    global _firebase_initialized
    if _firebase_initialized or firebase_admin._apps:
        _firebase_initialized = True
        return

    cred = None
    cred_json_env = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    if cred_json_env:
        try:
            cred_dict = json.loads(cred_json_env)
            cred = credentials.Certificate(cred_dict)
            logger.info("Firebase Admin initialized with FIREBASE_SERVICE_ACCOUNT_JSON env var")
        except Exception as e:
            logger.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: %s", e)

    if not cred:
        cred_val = (
            os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY")
            or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
            or os.getenv("FIREBASE_CREDENTIALS_PATH")
        )
        if cred_val:
            cred_val = cred_val.strip().strip('"').strip("'")
            if os.path.isfile(cred_val):
                try:
                    cred = credentials.Certificate(cred_val)
                    logger.info("Firebase Admin initialized with certificate from %s", cred_val)
                except Exception as e:
                    logger.error("Failed to load Firebase credentials from %s: %s", cred_val, e)
            elif cred_val.startswith("{") and cred_val.endswith("}"):
                try:
                    cred_dict = json.loads(cred_val)
                    cred = credentials.Certificate(cred_dict)
                    logger.info("Firebase Admin initialized with JSON certificate from env")
                except Exception as e:
                    logger.error("Failed to parse Firebase certificate JSON: %s", e)

    project_id = os.getenv("FIREBASE_PROJECT_ID", "sehat-538ee")

    try:
        if cred:
            firebase_admin.initialize_app(cred)
        else:
            firebase_admin.initialize_app(options={"projectId": project_id})
            logger.info("Firebase Admin initialized with project ID: %s", project_id)
        _firebase_initialized = True
    except Exception as e:
        logger.warning("Firebase Admin initialization: %s", e)
        _firebase_initialized = True


_chat_service_instance = None
_chat_service_lock = threading.Lock()


def get_chat_service():
    """Thread-safe singleton accessor for ChatService."""
    global _chat_service_instance
    if _chat_service_instance is None:
        with _chat_service_lock:
            if _chat_service_instance is None:
                _chat_service_instance = ChatService()
    return _chat_service_instance


FULL_TURN_WINDOW = 8


def extract_turn_pairs(messages):
    """
    Groups an ordered sequence of Message objects or dicts into turn-pairs.
    Each turn is:
    {
        "turn_index": int,
        "user": str,
        "bot": str,
        "messages": list of dicts [{'sender': ..., 'text': ...}]
    }
    """
    turns = []
    current_turn = None
    for msg in messages:
        sender = msg.sender if hasattr(msg, 'sender') else msg.get('sender', 'user')
        text = msg.message_text if hasattr(msg, 'message_text') else msg.get('text', msg.get('message_text', ''))
        
        if sender == 'user':
            if current_turn is not None:
                turns.append(current_turn)
            current_turn = {
                "turn_index": len(turns) + 1,
                "user": text,
                "bot": "",
                "messages": [{"sender": "user", "text": text}]
            }
        elif sender == 'bot':
            if current_turn is None:
                current_turn = {
                    "turn_index": len(turns) + 1,
                    "user": "",
                    "bot": text,
                    "messages": [{"sender": "bot", "text": text}]
                }
            else:
                current_turn["bot"] = text
                current_turn["messages"].append({"sender": "bot", "text": text})
            turns.append(current_turn)
            current_turn = None
            
    if current_turn is not None:
        turns.append(current_turn)
        
    return turns


def merge_patient_facts(current_context: dict, new_facts: dict) -> tuple[dict, bool]:
    """
    Merge newly extracted patient facts into session.patient_context.
    - Adds new keys.
    - If a new fact contradicts an existing one, update it and log the change
      (do NOT surface to user).
    - Returns (updated_context, changed_bool).
    """
    if not isinstance(current_context, dict):
        current_context = {}
    if not isinstance(new_facts, dict) or not new_facts:
        return current_context, False

    updated = dict(current_context)
    changed = False

    for key, val in new_facts.items():
        if val is None or val == "":
            continue
        key_norm = str(key).strip().lower()
        val_str = str(val).strip()

        if key_norm in updated:
            old_val = str(updated[key_norm]).strip()
            if old_val != val_str:
                logger.info(
                    "[MEMORY] Patient fact update (contradiction resolved) for '%s': '%s' -> '%s'",
                    key_norm, old_val, val_str
                )
                updated[key_norm] = val
                changed = True
        else:
            logger.info("[MEMORY] New patient fact recorded for '%s': '%s'", key_norm, val_str)
            updated[key_norm] = val
            changed = True

    return updated, changed


class ChatService:
    """Business logic for chat operations."""
    
    def __init__(self):
        self._rag_service = None

    @property
    def rag_service(self):
        if self._rag_service is None:
            from .rag_service import RAGService
            self._rag_service = RAGService()
        return self._rag_service

    @property
    def llm_service(self):
        return self.rag_service.llm_service
    
    def create_new_session(self, firebase_uid, title="New Chat"):
        return ChatSession.objects.create(
            firebase_uid=firebase_uid,
            title=title
        )
    
    def get_user_sessions(self, firebase_uid):
        return ChatSession.objects.filter(firebase_uid=firebase_uid).order_by('-updated_at')
    
    def get_session_messages(self, session_id, limit=20, offset=0):
        session = ChatSession.objects.get(id=session_id)
        messages = session.messages.all().order_by('timestamp')[offset:offset + limit]
        return messages

    def trigger_rolling_summarization_if_needed(self, session, turns=None) -> bool:
        """
        FULL_TURN_WINDOW = 8 turn-pairs kept in full.
        When total turns exceed summarized_up_to_turn + FULL_TURN_WINDOW:
        call Groq once with (existing rolling_summary + newly-overflowing turns)
        to produce an updated summary — merge, don't restart from scratch.
        Update summarized_up_to_turn.
        Does NOT run on every request, only when newly exceeded.
        """
        if turns is None:
            prior_messages = list(
                Message.objects.filter(session=session).order_by('sequence_number', 'timestamp')
            )
            turns = extract_turn_pairs(prior_messages)

        total_turns = len(turns)
        if total_turns > session.summarized_up_to_turn + FULL_TURN_WINDOW:
            overflow_end = total_turns - FULL_TURN_WINDOW
            overflow_turns = turns[session.summarized_up_to_turn:overflow_end]
            if overflow_turns:
                session.rolling_summary = self.llm_service.summarize_turns_with_groq(
                    session.rolling_summary, overflow_turns
                )
                session.summarized_up_to_turn = overflow_end
                session.save(update_fields=['rolling_summary', 'summarized_up_to_turn', 'updated_at'])
                return True
        return False
    
    # backend/chat/services.py

    def process_user_query(self, session_id, query, chat_history=None):
        """Process user query through RAG pipeline with backend-authoritative memory."""
        t_req_start = time.time()
        session = ChatSession.objects.get(id=session_id)
        
        # [MEMORY] Phase 2: Backend is authoritative source of truth.
        # Ignore client-supplied chat_history; fetch full ordered messages from Postgres for this session.
        prior_messages = list(
            Message.objects.filter(session=session).order_by('sequence_number', 'timestamp')
        )
        turns = extract_turn_pairs(prior_messages)
        logger.info("[MEMORY] Backend-authoritative history: %d prior messages (%d turns)", len(prior_messages), len(turns))

        # [MEMORY] Phase 4: Rolling summarization (Groq, rare trigger on window overflow)
        self.trigger_rolling_summarization_if_needed(session, turns)

        # [MEMORY] Phase 5: Last FULL_TURN_WINDOW turns kept in full
        recent_turns = turns[-FULL_TURN_WINDOW:] if turns else []
        recent_history = []
        for turn in recent_turns:
            recent_history.extend(turn["messages"])
        
        t_db_0 = time.time()
        user_msg = Message.objects.create(
            session=session,
            sender='user',
            message_text=query
        )
        t_user_create_ms = (time.time() - t_db_0) * 1000
        
        clarification_round = (session.session_metadata or {}).get("clarification_round", 0)
        context = self.rag_service.retrieve_context(
            query, recent_history,
            clarification_round=clarification_round,
            rolling_summary=session.rolling_summary,
            patient_context=session.patient_context
        )

        # ── Fix 1b: Subject-switch detection + context reset ──────────────────
        # If the unified intake call extracted a third-party subject_reference
        # that differs from the currently stored active subject, the user has
        # switched to asking about a completely different person. Reset context
        # entirely so prior facts don't bleed into the new case.
        subject_reference = context.get("subject_reference")  # str or None
        meta = session.session_metadata if isinstance(session.session_metadata, dict) else {}
        active_subject = meta.get("active_subject")  # None = "self" (default)

        if subject_reference is not None:
            # Normalize for comparison (case-insensitive, strip whitespace)
            ref_norm = subject_reference.strip().lower()
            active_norm = (active_subject or "").strip().lower()
            if ref_norm != active_norm:
                logger.info(
                    "[SUBJECT-SWITCH] New subject '%s' detected (was '%s'). Resetting patient_context and clarification_round.",
                    subject_reference, active_subject or "self"
                )
                # Full reset — discard all prior facts for the old subject
                session.patient_context = {}
                meta["active_subject"] = subject_reference
                meta["clarification_round"] = 0
                clarification_round = 0  # also reset local variable for this turn
                session.session_metadata = meta
                session.save(update_fields=["patient_context", "session_metadata", "updated_at"])
        elif subject_reference is None and active_subject is not None:
            # User switched back to talking about themselves — reset context
            logger.info(
                "[SUBJECT-SWITCH] User returned to self (was '%s'). Resetting patient_context.",
                active_subject
            )
            session.patient_context = {}
            meta["active_subject"] = None
            meta["clarification_round"] = 0
            clarification_round = 0
            session.session_metadata = meta
            session.save(update_fields=["patient_context", "session_metadata", "updated_at"])
        # ── end Fix 1b ────────────────────────────────────────────────────────
        
        # Phase 3: Merge new_facts into session.patient_context
        new_facts = context.get("extracted_facts") or context.get("new_facts") or {}
        if new_facts and isinstance(new_facts, dict):
            updated_ctx, changed = merge_patient_facts(session.patient_context, new_facts)
            if changed:
                session.patient_context = updated_ctx
                session.save(update_fields=['patient_context', 'updated_at'])

        # Phase 5: Wire rolling_summary and patient_context into final generation
        response = self.rag_service.generate_with_context(
            query, context, recent_history,
            rolling_summary=session.rolling_summary,
            patient_context=session.patient_context
        )

        status_type = context.get("status")
        if status_type == "clarifying":
            if not isinstance(session.session_metadata, dict):
                session.session_metadata = {}
            session.session_metadata["clarification_round"] = clarification_round + 1
        elif status_type in ("valid", "sufficient_for_answer", "meta_history", "off_topic"):
            if isinstance(session.session_metadata, dict) and "clarification_round" in session.session_metadata:
                session.session_metadata["clarification_round"] = 0

        t_db_1 = time.time()
        bot_meta = dict(response.get('metadata', {}))
        stage_timings = dict(bot_meta.get("stage_timings", {}))

        bot_msg = Message.objects.create(
            session=session,
            sender='bot',
            message_text=response['response'],
            metadata=bot_meta
        )
        session.save()

        t_db_writes_ms = round(t_user_create_ms + (time.time() - t_db_1) * 1000, 2)
        total_wall_clock_ms = round((time.time() - t_req_start) * 1000, 2)
        stage_timings["db_writes_ms"] = t_db_writes_ms
        stage_timings["total_wall_clock_ms"] = total_wall_clock_ms
        bot_meta["stage_timings"] = stage_timings
        bot_msg.metadata = bot_meta
        bot_msg.save(update_fields=['metadata'])

        logger.info(
            "[TIMING SUMMARY] total=%.2f ms | "
            "validate=%.2f ms | detect_lang=%.2f ms | classify_and_rewrite=%.2f ms | "
            "translate=%.2f ms | search=%.2f ms | verify_relevance=%.2f ms | "
            "generate_answer=%.2f ms | ragas_eval=%.2f ms | classify_triage=%.2f ms | db_writes=%.2f ms",
            total_wall_clock_ms,
            stage_timings.get("validate_query_ms", 0),
            stage_timings.get("detect_language_ms", 0),
            stage_timings.get("classify_and_rewrite_ms", 0),
            stage_timings.get("translate_query_ms", 0),
            stage_timings.get("hybrid_search_ms", 0),
            stage_timings.get("verify_relevance_ms", 0),
            stage_timings.get("generate_answer_ms", 0),
            stage_timings.get("ragas_eval_ms", 0),
            stage_timings.get("classify_triage_ms", 0),
            t_db_writes_ms
        )

        return user_msg, bot_msg
        
       
    
    def delete_session(self, session_id):
        session = ChatSession.objects.get(id=session_id)
        session.delete()
    
    def delete_message(self, message_id):
        message = Message.objects.get(id=message_id)
        message.delete()
    
    def add_document(self, pdf_file, filename: str) -> dict:
        """Add a new medical document to the knowledge base."""
        try:
            import os
            
            medical_docs_dir = self.rag_service.medical_docs_dir
            
            # Ensure directory exists
            os.makedirs(medical_docs_dir, exist_ok=True)
            
            file_path = os.path.join(medical_docs_dir, filename)
            
            # Save file correctly
            with open(file_path, 'wb+') as destination:
                for chunk in pdf_file.chunks():
                    destination.write(chunk)
            
            print(f"[ADD] File saved to: {file_path}")
            
            # Auto-index the document immediately
            result = self.rag_service.load_document(file_path, filename)
            print(f"[ADD] Indexing result: {result}")
            
            return {
                "success": True,
                "filename": filename,
                "message": result
            }
        except Exception as e:
            print(f"[ADD] Error: {e}")
            return {
                "success": False,
                "filename": filename,
                "error": str(e)
            }
        
    def remove_document(self, filename: str) -> dict:
        """Remove a document from the knowledge base."""
        return self.rag_service.remove_document(filename)
    
    def get_documents(self) -> list:
        """Get list of all loaded documents."""
        result = self.rag_service.get_loaded_documents()
        
        # Handle double-nested response
        if isinstance(result, dict):
            if result.get('success') and 'documents' in result:
                docs = result['documents']
                # Check if documents is also a dict (double-nested)
                if isinstance(docs, dict) and 'documents' in docs:
                    return docs['documents']
                # If documents is a list, return directly
                if isinstance(docs, list):
                    return docs
            # Direct list
            if 'documents' in result and isinstance(result['documents'], list):
                return result['documents']
        
        return result if isinstance(result, list) else []


class AuthenticationService:
    """Firebase authentication integration."""

    def verify_firebase_token(self, token: str):
        """
        Verify Firebase ID token sent from the client using firebase_admin SDK.
        Returns: verified uid (str) on success, or None on missing/invalid/expired token.
        """
        if not token or not isinstance(token, str) or not token.strip():
            logger.warning("Firebase token missing or empty")
            return None

        clean_token = token.strip()
        if clean_token.lower().startswith("bearer "):
            clean_token = clean_token[7:].strip()

        # Ensure Firebase Admin is initialized
        initialize_firebase_admin()

        try:
            decoded_token = auth.verify_id_token(clean_token)
            uid = decoded_token.get("uid")
            if uid:
                logger.info("Successfully verified Firebase ID token for UID: %s", uid)
                return uid
            logger.warning("Firebase ID token verification returned no uid in payload")
            return None
        except auth.ExpiredIdTokenError:
            logger.warning("Firebase ID token has expired")
            return None
        except auth.InvalidIdTokenError as e:
            logger.warning("Invalid Firebase ID token: %s", e)
            return None
        except Exception as e:
            logger.error("Firebase ID token verification failed: %s", e)
            return None

    def validate_user(self, firebase_uid):
        return bool(firebase_uid)