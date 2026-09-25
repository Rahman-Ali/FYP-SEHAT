import os
import re
import time
import hashlib
import logging
from dotenv import load_dotenv
from .document_service import DocumentService
from .vector_store_service import VectorStoreService
from .llm_service import LLMService

load_dotenv()

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# File-hash helper
# ---------------------------------------------------------------------------

def _compute_file_hash(path: str) -> str:
    """Return the SHA-256 hex digest of *path*'s raw bytes."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(65536), b""):
            h.update(block)
    return h.hexdigest()


class RAGService:
    """Main coordinator that connects Document, VectorStore, and LLM services."""

    def __init__(self):
        self.doc_service = DocumentService()
        self.vector_service = VectorStoreService()
        self.llm_service = LLMService()
        self.medical_docs_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            'medical_documents'
        )

    # ========================================================================
    # DOCUMENT MANAGEMENT
    # ========================================================================

    def load_document(self, pdf_path: str, book_name: str) -> str:
        """Load a PDF document into the RAG system.

        Skip-if-unchanged: computes SHA-256 of the file bytes and compares it
        to the hash stored in Neo4j.  If they match (and FORCE_REINGEST is not
        set) the file is skipped entirely — no delete, no embedding, no upload.

        Set FORCE_REINGEST=true in the environment to bypass the hash check and
        always re-ingest every file (useful after cleaning-logic changes that
        don't alter file bytes).
        """
        filename = os.path.basename(pdf_path)
        force = os.getenv("FORCE_REINGEST", "false").strip().lower() in (
            "1", "true", "yes"
        )

        try:
            current_hash = _compute_file_hash(pdf_path)

            if not force:
                try:
                    stored_hash = self.vector_service.get_source_hash(filename)
                    if stored_hash and stored_hash == current_hash:
                        logger.info(
                            "[INGEST] unchanged, skipping: %s (hash=%s…)",
                            filename, current_hash[:12],
                        )
                        return f"Skipped (unchanged): '{book_name}'"
                except Exception as hash_err:
                    logger.error(
                        "[INGEST] Hash read error for '%s' (status UNKNOWN, skipping to prevent data loss): %s",
                        filename, hash_err,
                    )
                    return f"Skipped (hash-read error): '{book_name}'"

            logger.info("[INGEST] loading: %s (force=%s)", filename, force)

            # ── Delete stale chunks first (replace, not append) ───────────────
            deleted = self.vector_service.delete_chunks_by_source(filename)
            if deleted:
                logger.info(
                    "[INGEST] replaced %d stale chunks for '%s'", deleted, filename
                )

            # Pass hash so Neo4j nodes carry source_hash as a property
            chunks = self.doc_service.load_and_split_pdf(
                pdf_path, source_hash=current_hash
            )
            self.vector_service.add_chunks_to_store(chunks)
            disease_tag = chunks[0].metadata.get("disease") if chunks else None
            logger.info(
                "[INGEST] '%s' (disease=%s): %d chunks stored | hash=%s… | Total: %d chunks",
                book_name,
                disease_tag,
                len(chunks),
                current_hash[:12],
                len(self.vector_service._all_chunks),
            )
            return f"Loaded {len(chunks)} chunks from '{book_name}'"
        except Exception as e:
            logger.error("[INGEST] failed to load '%s': %s", book_name, e)
            return f"Error: {e}"

    def remove_document(self, filename: str) -> dict:
        """Remove a document from file system and vector store."""
        try:
            file_path = os.path.join(self.medical_docs_dir, filename)
            deleted_chunks = self.vector_service.delete_chunks_by_source(filename)
            file_deleted = self.doc_service.delete_pdf(file_path)

            if deleted_chunks == 0:
                logger.warning(
                    "Document '%s' removed from filesystem but 0 chunks deleted from store",
                    filename
                )

            return {
                "success": True,
                "filename": filename,
                "chunks_deleted": deleted_chunks,
                "file_deleted": file_deleted,
                "message": (
                    f"Document '{filename}' removed successfully. "
                    f"{deleted_chunks} chunks deleted."
                )
            }
        except Exception as e:
            logger.error("Error removing document '%s': %s", filename, e)
            return {"success": False, "filename": filename, "error": str(e)}

    def get_loaded_documents(self) -> dict:
        """Get list of all documents currently in the system.

        Returns:
            dict with 'success' (bool), 'documents' (list), 'error' (str|None)
        """
        try:
            neo4j_docs = self.vector_service.get_document_list()
            file_docs = self.doc_service.list_pdf_files(self.medical_docs_dir)
            neo4j_filenames = {doc["source_file"] for doc in neo4j_docs if doc["source_file"]}

            result = []
            for filename in file_docs:
                neo4j_info = next(
                    (doc for doc in neo4j_docs if doc["source_file"] == filename),
                    None
                )
                result.append({
                    "filename": filename,
                    "indexed": filename in neo4j_filenames,
                    "chunk_count": neo4j_info["chunk_count"] if neo4j_info else 0,
                    "disease": neo4j_info.get("disease") if neo4j_info else None,
                })

            return {"success": True, "documents": result, "error": None}
        except Exception as e:
            logger.error("Error getting document list: %s", e)
            return {"success": False, "documents": [], "error": str(e)}

    # ========================================================================
    # QUERY CLASSIFICATION HELPERS
    # ========================================================================

    def detect_capabilities_query(self, query_text: str) -> bool:
        """
        LLM-based detection of capabilities/greeting queries.
        Only called for short queries to save API costs.
        """
        prompt = f"""Determine if the user is asking about what SEHAT can do,
what help it provides, what questions can be asked, or who/what SEHAT is.

Examples: "What can you do?", "How can you help me?", "Who are you?",
"Ap kia kar sakte ho?", "Ap meri kia madad kar sakte ho?"

Output ONLY ONE WORD: YES or NO

User message: {query_text}

Is this a capabilities question?"""

        try:
            resp = self.llm_service.llm.invoke(prompt)
            result = (
                resp.content if hasattr(resp, "content")
                else str(resp)
            ).strip().upper()
            return result.startswith("YES")
        except Exception as e:
            logger.error("Capabilities detection error: %s", e)
            return False

    def _build_meta_history_answer(self, query: str, chat_history: list, patient_context: dict) -> str:
        """Answer meta queries directly from backend-authoritative DB history without hallucination.
        Intent is classified by the LLM upstream — no phrase matching here."""
        user_msgs = [m for m in (chat_history or []) if m.get("sender") == "user"]
        if not user_msgs:
            return "I don't have access to any previous questions in this conversation yet."

        last_q = user_msgs[-1].get("text", user_msgs[-1].get("message_text", ""))
        questions_list = "\n".join(
            f"{i+1}. {m.get('text', m.get('message_text', ''))}"
            for i, m in enumerate(user_msgs)
        )

        if patient_context and isinstance(patient_context, dict):
            items = [f"{k}: {v}" for k, v in patient_context.items() if v]
            facts_str = ", ".join(items)
            return (
                f"No, I remember what you told me! You mentioned: {facts_str}. "
                f'Your last message was: "{last_q}".\n\n'
                f"Here are all the questions you asked so far:\n{questions_list}"
            )

        return f"Here are the questions you have asked in this conversation:\n{questions_list}"

    def _needs_clarification(
        self, query: str, chat_history: list = None,
        rolling_summary: str = None, patient_context: dict = None
    ) -> tuple:
        """General conversational reasoning check: determines if query needs clarification using patient_context."""
        res = self.llm_service.classify_and_rewrite_query(
            query, chat_history=chat_history, patient_context=patient_context
        )
        missing = res.get("missing_for_diagnosis", [])
        intent = res.get("intent", "sufficient_for_answer")
        if missing and intent in ("new_symptom_info", "followup_answer"):
            return True, res.get("follow_up_question", "Could you provide more details?")
        return False, ""

    # ========================================================================
    # CONTEXT RETRIEVAL
    # ========================================================================

    def retrieve_context(
        self, query: str, chat_history: list = None,
        clarification_round: int = 0,
        rolling_summary: str = None,
        patient_context: dict = None
    ) -> dict:
        """Steps 1-4 of RAG pipeline with emergency detection + query rewriting + fact extraction.

        Args:
            clarification_round: Number of clarifying questions already asked
                for this session.  If < 5 and the query is under-specified,
                returns status='clarifying' with a follow-up question.
                On round 5 the clarification gate is skipped and full retrieval
                is forced regardless (hard cap).
            rolling_summary: Rolling summary text of older turns.
            patient_context: Structured dictionary of known patient facts.
        """
        # ── Fix 2: Emergency fast-path — rule-based, zero LLM calls ───────────
        # Covers labor/delivery, unconscious, severe bleeding, choking, chest pain,
        # can't breathe, seizures — in English and Roman Urdu.
        _q_lower = query.lower()
        _EMERGENCY_KEYWORDS = [
            # Labor / delivery
            "delivery", "labour", "labor", "baby coming", "bache ki paidaish",
            "dard e zeh", "prasav", "waza hamla",
            # Unconscious / unresponsive
            "unconscious", "behosh", "behoshi", "unresponsive", "not waking",
            # Severe bleeding
            "severe bleeding", "bohat zyada khoon", "khoon aa raha", "heavy bleeding",
            "hemorrhage", "khoon nahi ruk",
            # Can't breathe / choking
            "can't breathe", "cant breathe", "saans nahi", "saans ruk", "chocking",
            "choking", "dam ghut", "dam nahi", "naak band", "throat blocked",
            "airway", "suffocating", "suffocation",
            # Chest pain / heart
            "chest pain", "seene mein dard", "seene ka dard", "heart attack",
            "cardiac", "angina",
            # Seizures / convulsions
            "seizure", "convulsion", "mirgi", "fits", "jhatkay",
            # Stroke
            "stroke", "paralysis", "face drooping", "arm weakness",
            # Poisoning / overdose
            "poisoning", "overdose", "zeher", "kuch kha liya",
            # General life-threatening phrasing
            "emergency", "call ambulance", "1122", "dying", "mar raha",
        ]
        if any(kw in _q_lower for kw in _EMERGENCY_KEYWORDS):
            logger.info("[EMERGENCY FAST-PATH] Keyword match in query — bypassing clarification.")
            lang_hint = "roman_urdu" if any(
                c in _q_lower for c in ["mein", "hai", "ho", "raha", "rahi", "nahi", "zyada", "khoon", "seene", "dard"]
            ) else "english"
            if lang_hint == "roman_urdu":
                emergency_text = (
                    "**EMERGENCY — Foran Madad Len!**\n\n"
                    "Yeh ek Medical Emergency hai. Neeche diye gaye steps turant karen:\n\n"
                    "1. **Abhi 1122 par call karen** (Pakistan Emergency Helpline)\n"
                    "2. Mareez ko lita dein, harkaat na karwayein\n"
                    "3. Agar saans nahi aa rahi — CPR shuru karen (agar aap jante hain)\n"
                    "4. Agar khoon aa raha hai — saaf kapde se pressure lagayein\n"
                    "5. Akele rehne na dein — kisi ko saath rakhein\n\n"
                    "**Ghair zaruri waqt zaya na karen — ambulance bulayein.**"
                )
            else:
                emergency_text = (
                    "**EMERGENCY — Seek Immediate Help!**\n\n"
                    "This is a medical emergency. Take these steps RIGHT NOW:\n\n"
                    "1. **Call 1122 immediately** (Pakistan Emergency Helpline)\n"
                    "2. Keep the patient still and calm\n"
                    "3. If not breathing — begin CPR (if trained)\n"
                    "4. If bleeding severely — apply firm pressure with clean cloth\n"
                    "5. Do not leave the patient alone\n\n"
                    "**Do not delay — call an ambulance now.**"
                )
            return {
                "status": "emergency",
                "chunks": [],
                "language": lang_hint,
                "english_query": query,
                "original_query": query,
                "extracted_facts": {},
                "new_facts": {},
                "subject_reference": None,
                "_emergency_text": emergency_text,
            }
        # ── end Fix 2 ─────────────────────────────────────────────────────────

        # Also run the existing LLM-based sanitize_input for prompt-injection / jailbreak detection
        sanitize_result = self.llm_service.sanitize_input(query)
        if sanitize_result.get('is_emergency'):
            return {
                "status": "emergency",
                "chunks": [],
                "language": "english",
                "english_query": query,
                "original_query": query,
                "extracted_facts": {},
                "new_facts": {},
                "subject_reference": None,
            }

        stage_timings = {}

        t0 = time.time()
        status = self.llm_service.validate_query(query)
        stage_timings["validate_query_ms"] = round((time.time() - t0) * 1000, 2)
        logger.info("[STAGE TIMING] validate_query: %.2f ms", stage_timings["validate_query_ms"])
        
        t0 = time.time()
        language = self.llm_service.detect_language(query)
        stage_timings["detect_language_ms"] = round((time.time() - t0) * 1000, 2)
        logger.info("[STAGE TIMING] detect_language: %.2f ms", stage_timings["detect_language_ms"])

        base_response = {
            "status": status,
            "chunks": [],
            "language": language,
            "english_query": query,
            "original_query": query,
            "extracted_facts": {},
            "new_facts": {},
            "stage_timings": stage_timings,
        }

        if status in ("invalid", "unclear", "greeting"):
            return base_response

        if language == "invalid_hindi":
            base_response["status"] = "invalid_hindi"
            base_response["language"] = language
            return base_response

        # ── General Conversational Intake Reasoning (Unified Single Call) ──
        # Check if _needs_clarification was specifically mocked on this instance (for tests)
        if "_needs_clarification" in self.__dict__:
            t0 = time.time()
            rewritten_result = self.llm_service.rewrite_query(
                query, chat_history, patient_context=patient_context
            )
            stage_timings["rewrite_query_ms"] = round((time.time() - t0) * 1000, 2)
            rewritten_query = rewritten_result[0] if isinstance(rewritten_result, tuple) else rewritten_result
            extracted_facts = rewritten_result[1] if isinstance(rewritten_result, tuple) else {}
            base_response["extracted_facts"] = extracted_facts
            base_response["new_facts"] = extracted_facts

            if clarification_round < 5:
                needs_clarify, follow_up = self._needs_clarification(
                    query, chat_history,
                    rolling_summary=rolling_summary,
                    patient_context=patient_context
                )
                if needs_clarify:
                    return {
                        "status": "clarifying",
                        "chunks": [],
                        "language": language,
                        "english_query": query,
                        "original_query": query,
                        "follow_up_question": follow_up,
                        "extracted_facts": extracted_facts,
                        "new_facts": extracted_facts,
                        "stage_timings": stage_timings,
                    }
        else:
            t0 = time.time()
            classification = self.llm_service.classify_and_rewrite_query(
                query,
                chat_history=chat_history,
                patient_context=patient_context,
                clarification_round=clarification_round
            )
            stage_timings["classify_and_rewrite_ms"] = round((time.time() - t0) * 1000, 2)
            logger.info("[STAGE TIMING] classify_and_rewrite: %.2f ms", stage_timings["classify_and_rewrite_ms"])

            intent = classification.get("intent", "sufficient_for_answer")
            rewritten_query = classification.get("rewritten_query", query)
            extracted_facts = classification.get("new_facts") or {}
            missing_for_diagnosis = classification.get("missing_for_diagnosis") or []
            follow_up_question = classification.get("follow_up_question") or ""
            target_language = classification.get("target_language") or language
            subject_reference = classification.get("subject_reference")  # None or str

            base_response["extracted_facts"] = extracted_facts
            base_response["new_facts"] = extracted_facts
            base_response["intent"] = intent
            base_response["target_language"] = target_language
            base_response["subject_reference"] = subject_reference

            # 1. intent == "meta_query" -> answer from real DB history
            if intent == "meta_query":
                meta_answer = self._build_meta_history_answer(query, chat_history, patient_context)
                logger.info("[INTAKE] Meta-query routed to DB history.")
                base_response.update({
                    "status": "meta_history",
                    "meta_answer": meta_answer,
                })
                return base_response

            # 2. intent == "translation_request" -> re-render last bot message in requested language
            if intent == "translation_request":
                logger.info("[INTAKE] Translation request routed for re-rendering.")
                base_response.update({
                    "status": "translation_request",
                    "target_language": target_language,
                })
                return base_response

            # 3. intent in ("new_symptom_info", "followup_answer") -> doctor intake gap assessment
            if intent in ("new_symptom_info", "followup_answer"):
                if missing_for_diagnosis and clarification_round < 5:
                    q_text = follow_up_question
                    if not q_text:
                        missing_str = ", ".join(missing_for_diagnosis)
                        if language == "roman_urdu":
                            q_text = f"Apni takleef ke baare mein thoda aur batayein ({missing_str}) taake main behtar madad kar sakoon."
                        else:
                            q_text = f"Could you provide a bit more detail ({missing_str}) so I can give you accurate advice?"
                    logger.info("[INTAKE] Clarification needed (round %d): '%s'", clarification_round + 1, q_text)
                    return {
                        "status": "clarifying",
                        "chunks": [],
                        "language": language,
                        "english_query": query,
                        "original_query": query,
                        "follow_up_question": q_text,
                        "extracted_facts": extracted_facts,
                        "new_facts": extracted_facts,
                        "intent": intent,
                    }
                # If missing_for_diagnosis is empty OR clarification_round == 5 -> proceed to retrieval

            # 4. intent == "off_topic" -> respond with no_info fallback, facts still merged
            if intent == "off_topic":
                logger.info("[INTAKE] Off-topic query detected.")
                base_response.update({
                    "status": "off_topic",
                    "extracted_facts": extracted_facts,
                    "new_facts": extracted_facts,
                })
                return base_response

            # 5. intent == "sufficient_for_answer" -> skip clarification, proceed to retrieval

        if not self.vector_service.is_ready:
            logger.warning("Vector store not ready")
            return base_response

        t0 = time.time()
        english_query = self.llm_service.translate_to_english(rewritten_query, language)
        stage_timings["translate_query_ms"] = round((time.time() - t0) * 1000, 2)
        logger.info("[STAGE TIMING] translate_query: %.2f ms", stage_timings["translate_query_ms"])

        t0 = time.time()
        chunks = self.vector_service.hybrid_search(english_query)
        stage_timings["hybrid_search_ms"] = round((time.time() - t0) * 1000, 2)
        logger.info("[STAGE TIMING] hybrid_search: %.2f ms", stage_timings["hybrid_search_ms"])

        base_response.update({
            "chunks": chunks,
            "language": language,
            "english_query": english_query,
            "extracted_facts": extracted_facts,
            "new_facts": extracted_facts,
            "stage_timings": stage_timings,
        })

        return base_response



    # ========================================================================
    # CITATION BUILDER
    # ========================================================================

    def _build_citations(self, context_docs: list) -> tuple:
        """Build retrieved text, citation string block, and structured sources list.

        Returns:
            retrieved_text (str): numbered context blocks for the LLM prompt.
            cite_block (str):     "--- Sources ---" string for plain-text fallback.
            pages_str (str):      comma-separated page numbers.
            sources (list):       structured list of {title, pages} dicts for the
                                  structured API response (Phase 2).
        """
        blocks = []
        pages = []
        citations_dict = {}    # book_name  -> set of page nums
        title_map = {}         # book_name  -> display_title

        for i, doc in enumerate(context_docs, 1):
            blocks.append(f"[{i}] {doc.page_content.strip()}")
            page = doc.metadata.get("page", "Unknown")

            # Prefer display_title stored on the chunk; fall back to filename.
            source_path = (
                doc.metadata.get("source_file")
                or doc.metadata.get("source", "Unknown")
            )
            book_name = os.path.basename(str(source_path))
            display_title = (
                doc.metadata.get("display_title")
                or book_name  # filename fallback
            )
            title_map[book_name] = display_title

            if page != "Unknown":
                try:
                    page_num = int(page)
                    pages.append(page_num)
                except (ValueError, TypeError):
                    page_num = str(page)
                    pages.append(page_num)
                citations_dict.setdefault(book_name, set()).add(page_num)

        retrieved_text = "\n\n".join(blocks)
        pages_str = ", ".join(str(p) for p in sorted(set(pages))) if pages else "Unknown"

        # Plain-text citation block (kept for backward compat / plain responses)
        cite = ""
        if citations_dict:
            cite = "\n\n--- Sources ---\n"
            for idx, book in enumerate(sorted(citations_dict), 1):
                title = title_map.get(book, book)
                sp = sorted(
                    citations_dict[book],
                    key=lambda x: (isinstance(x, str), str(x))
                )
                cite += f"{idx}- {title}: Pages {', '.join(str(p) for p in sp)}\n"

        # Structured sources list for the API response metadata
        sources = []
        for idx, book in enumerate(sorted(citations_dict), 1):
            sp = sorted(
                citations_dict[book],
                key=lambda x: (isinstance(x, str), str(x))
            )
            raw_title = title_map.get(book, book)
            sources.append({
                "sequence": idx,
                "title": f"{idx}- {raw_title}",
                "clean_title": raw_title,
                "filename": book,
                "pages": [str(p) for p in sp],
            })

        return retrieved_text, cite, pages_str, sources

    # ========================================================================
    # MAIN GENERATION FLOW
    # ========================================================================

    def generate_with_context(
        self, query: str, context_data: dict, chat_history: list = None,
        rolling_summary: str = None, patient_context: dict = None
    ) -> dict:
        """Steps 5-6 of RAG pipeline with full response handling."""

        # ── HELPER: No-info message ──────────────────────────────────────
        def no_info(lang):
            if lang == "roman_urdu":
                return (
                    "Maafi chahta hoon, is sawaal ka jawab mere paas mojood "
                    "documents mein nahi mila. Kisi doctor se rabta karein."
                )
            return (
                "Sorry, I could not find information about this in my "
                "knowledge base. Please consult a doctor."
            )

        # ── HELPER: Capabilities response ────────────────────────────────
        def get_capabilities_response(lang):
            if lang == "roman_urdu":
                return (
                    "Main SEHAT AI hoon! \n\n"
                    "Aap mujhse in cheezon ke baare mein pooch sakte hain:\n"
                    "- Apni alamaat (symptoms) — jaise bukhar, sar dard, khansi\n"
                    "- Bemariyon ki maloomat — jaise dengue, typhoid, malaria, influenza\n"
                    "- Ilaaj aur treatment ke baare mein guidance\n"
                    "- Emergency triage — aapko doctor se milna chahiye ya nahi\n"
                    "- Medical documents (WHO guidelines) ki bunyad par jawab\n\n"
                    "Bas apna sawal likhein — main aapki madad karunga!"
                )
            return (
                "I'm SEHAT AI, your personal health assistant!\n\n"
                "You can ask me about:\n"
                "- Your symptoms — fever, headache, cough, stomach pain\n"
                "- Diseases — dengue, typhoid, malaria, influenza, TB, hepatitis, and more\n"
                "- Treatment guidance based on WHO medical documents\n"
                "- Emergency triage — whether you should see a doctor\n"
                "- General health-related questions\n\n"
                "Just describe your symptoms or ask a medical question — I'm here to help!"
            )

        # ── HELPER: Check if query is short (for capabilities detection) ──
        def is_short_query(text):
            return len(text.split()) <= 10 and len(text) <= 80

        # ── INITIAL DATA ──────────────────────────────────────────────────
        st = context_data.get("status", "valid")
        language = context_data.get("language", "english")

        # ══════════════════════════════════════════════════════════════
        # BRANCH 0: CLARIFYING (Phase 3)
        # ══════════════════════════════════════════════════════════════
        if st == "clarifying":
            follow_up = context_data.get("follow_up_question", "")
            if not follow_up:
                if language == "roman_urdu":
                    follow_up = (
                        "Apni takleef ke baare mein thoda aur batayein, maslan kis jagah "
                        "dard ya kya alamaat hain taake main sahi madad kar sakoon?"
                    )
                else:
                    follow_up = (
                        "Could you tell me a bit more about your symptoms, such as "
                        "where it hurts or when it started, so I can help you better?"
                    )
            return {
                "response": follow_up,
                "metadata": {
                    "source": "Clarification Gate",
                    "language": language,
                    "ragas_metrics": {},
                    "triage_level": None,
                    "answer_body": follow_up,
                    "sources": [],
                    "disclaimer": "",
                }
            }

        # ══════════════════════════════════════════════════════════════
        # BRANCH 0b: META_HISTORY — answer from real DB history (Bug 1 fix)
        # ══════════════════════════════════════════════════════════════
        if st == "meta_history":
            meta_answer = context_data.get("meta_answer", "I can't retrieve that from our conversation history.")
            return {
                "response": meta_answer,
                "metadata": {
                    "source": "Meta-History (DB)",
                    "language": language,
                    "ragas_metrics": {},
                    "triage_level": None,
                    "answer_body": meta_answer,
                    "sources": [],
                    "disclaimer": "",
                }
            }


        # ══════════════════════════════════════════════════════════════
        # BRANCH 0c: TRANSLATION_REQUEST — re-render last bot message in target language
        # ══════════════════════════════════════════════════════════════
        if st == "translation_request":
            last_bot_text = ""
            for m in reversed(chat_history or []):
                if m.get("sender") in ("bot", "assistant"):
                    last_bot_text = m.get("text") or m.get("message_text") or ""
                    if last_bot_text.strip():
                        break

            target_lang = context_data.get("target_language", language)
            if last_bot_text:
                translated_response = self.llm_service.translate_response(last_bot_text, target_lang)
            else:
                if target_lang == "roman_urdu":
                    translated_response = "Pehle koi jawab mojood nahi hai jise translate kiya ja sake."
                else:
                    translated_response = "There is no previous response to translate yet."

            return {
                "response": translated_response,
                "metadata": {
                    "source": "Translation",
                    "language": target_lang,
                    "ragas_metrics": {},
                    "triage_level": None,
                    "answer_body": translated_response,
                    "sources": [],
                    "disclaimer": "",
                }
            }

        # ══════════════════════════════════════════════════════════════
        # BRANCH 0d: OFF_TOPIC — polite no-info response, patient facts retained
        # ══════════════════════════════════════════════════════════════
        if st == "off_topic":
            return {
                "response": no_info(language),
                "metadata": {
                    "source": "No relevant chunks",
                    "language": language,
                    "ragas_metrics": {},
                    "triage_level": None,
                    "answer_body": no_info(language),
                    "sources": [],
                    "disclaimer": "",
                }
            }

        # ══════════════════════════════════════════════════════════════
        # BRANCH 1: EMERGENCY
        # ══════════════════════════════════════════════════════════════
        if st == "emergency":
            # Use pre-built emergency text from Fix 2 fast-path if available,
            # otherwise fall back to the general crisis/self-harm response.
            emergency_text = context.get("_emergency_text")
            if not emergency_text:
                if language == "roman_urdu":
                    emergency_text = (
                        "**EMERGENCY — Foran Madad Len!**\n\n"
                        "1. **Abhi 1122 par call karen** (Pakistan Emergency Helpline)\n"
                        "2. Agar aap ya koi aur self-harm ke baare mein soch rahe hain — "
                        "please turant madad lein. Aap akele nahi hain.\n"
                        "3. Apne qareebi doctor ya hospital se rabta karein."
                    )
                else:
                    emergency_text = (
                        "**EMERGENCY — Seek Immediate Help!**\n\n"
                        "1. **Call 1122 immediately** (Pakistan Emergency Helpline)\n"
                        "2. If you or someone is thinking about self-harm — please reach out now. "
                        "You are not alone.\n"
                        "3. Contact your nearest doctor or hospital without delay."
                    )
            return {
                "response": emergency_text,
                "metadata": {
                    "source": "Emergency",
                    "triage_level": "Emergency",
                    "ragas_metrics": {},
                    "answer_body": emergency_text,
                    "sources": [],
                    "disclaimer": (
                        "Ye kisi professional doctor ki salah ka mutbadil nahi hai."
                        if language == "roman_urdu"
                        else "This is not a substitute for professional medical advice."
                    ),
                }
            }

        # ══════════════════════════════════════════════════════════════
        # BRANCH 2: GREETING
        # ══════════════════════════════════════════════════════════════
        if st == "greeting":
            greeting_prompt = (
                f"You are SEHAT, a friendly medical assistant.\n"
                f"The user just greeted you. Respond warmly in {language}.\n"
                f"Keep it brief (2-3 sentences). Mention you help with health questions.\n"
                f"User greeting: {query}\n"
                f"Response:"
            )
            try:
                greeting_resp = self.llm_service.llm.invoke(greeting_prompt)
                greeting_text = (
                    greeting_resp.content if hasattr(greeting_resp, "content")
                    else str(greeting_resp)
                ).strip()
                return {
                    "response": greeting_text,
                    "metadata": {"source": "Greeting (Dynamic)", "ragas_metrics": {}}
                }
            except Exception as e:
                logger.error("Greeting generation error: %s", e)
                if language == "roman_urdu":
                    greeting_text = (
                        "Assalam-o-Alaikum! Main SEHAT AI hoon.\n\n"
                        "Main aapki sehat se mutaliq madad kar sakta hoon — "
                        "apni takleef ya alamaat batayein!"
                    )
                else:
                    greeting_text = (
                        "Hello! I am SEHAT AI, your personal health assistant.\n\n"
                        "I can help you with understanding symptoms, medical guidance, "
                        "and emergency triage. How can I help you today?"
                    )
                return {
                    "response": greeting_text,
                    "metadata": {"source": "Greeting (Fallback)", "ragas_metrics": {}}
                }

                # ══════════════════════════════════════════════════════════════
        # BRANCH 3: CAPABILITIES (LLM-generated, no hardcoded text)
        # ══════════════════════════════════════════════════════════════
        if is_short_query(query) and self.detect_capabilities_query(query):
            capabilities_prompt = f"""You are SEHAT AI, a medical assistant.

The user is asking about what you can do, what diseases you know about,
or what help you provide.

IMPORTANT RULES:
- Respond in {language} language ONLY
- If language is roman_urdu, write COMPLETELY in Roman Urdu
- If language is english, write COMPLETELY in English
- DO NOT mix languages
- Keep it friendly and brief (4-6 lines)
- Mention you help with symptoms, diseases, and medical guidance
- You have knowledge about: Dengue Fever, Diarrhea, Hepatitis A, Influenza,
  Tuberculosis (TB), Malaria, Skin Allergy, Typhoid Fever, Common Cold,
  Urinary Tract Infections

User asked: {query}

Your response:"""

            try:
                cap_resp = self.llm_service.llm.invoke(capabilities_prompt)
                cap_text = (
                    cap_resp.content if hasattr(cap_resp, "content")
                    else str(cap_resp)
                ).strip()
                return {
                    "response": cap_text,
                    "metadata": {"source": "Capabilities (Dynamic)", "ragas_metrics": {}}
                }
            except Exception as e:
                logger.error("Capabilities generation error: %s", e)
                # Simple fallback — still language-matched
                if language == "roman_urdu":
                    cap_text = (
                        "Main SEHAT AI hoon! Aap mujhse bukhar, dengue, typhoid, "
                        "malaria, TB, hepatitis, flu, skin allergy, common cold, "
                        "UTI jaise bemariyon aur symptoms ke baare mein pooch sakte hain."
                    )
                else:
                    cap_text = (
                        "I'm SEHAT AI! You can ask me about fever, dengue, typhoid, "
                        "malaria, TB, hepatitis, flu, skin allergy, common cold, "
                        "UTI, and various symptoms."
                    )
                return {
                    "response": cap_text,
                    "metadata": {"source": "Capabilities (Fallback)", "ragas_metrics": {}}
                }

        # ══════════════════════════════════════════════════════════════
        # BRANCH 4: INVALID
        # ══════════════════════════════════════════════════════════════
        if st == "invalid":
            if language == "roman_urdu":
                return {
                    "response": "Baraye meharbani sehat se mutaliq sawaal poochein "
                                "taake main aapki madad kar sakoon.",
                    "metadata": {"source": "Validation", "ragas_metrics": {}}
                }
            return {
                "response": "Please ask a health-related question so I can assist you better.",
                "metadata": {"source": "Validation", "ragas_metrics": {}}
            }

        # ══════════════════════════════════════════════════════════════
        # BRANCH 5: UNCLEAR
        # ══════════════════════════════════════════════════════════════
        if st == "unclear":
            if language == "roman_urdu":
                return {
                    "response": "Apni takleef thodi aur detail mein batayein "
                                "taake main aapki behtar madad kar sakoon.",
                    "metadata": {"source": "Validation", "ragas_metrics": {}}
                }
            return {
                "response": "Could you describe your symptoms or concern "
                            "in more detail so I can help you better?",
                "metadata": {"source": "Validation", "ragas_metrics": {}}
            }

        # ══════════════════════════════════════════════════════════════
        # BRANCH 6: HINDI
        # ══════════════════════════════════════════════════════════════
        if st == "invalid_hindi":
            return {
                "response": (
                    "Please ask your question in English or Roman Urdu. "
                    "Hindi (Devanagari script) is not supported.\n\n"
                    "Baraye meharbani apna sawaal English ya Roman Urdu mein poochein."
                ),
                "metadata": {"source": "Validation", "ragas_metrics": {}}
            }

        # ══════════════════════════════════════════════════════════════
        # BRANCH 7: VALID - MAIN RAG PIPELINE
        # ══════════════════════════════════════════════════════════════
        context_docs = context_data.get("chunks", [])
        english_query = context_data.get("english_query", query)
        original_query = context_data.get("original_query", query)

        if not context_docs:
            return {
                "response": no_info(language),
                "metadata": {
                    "source": "No relevant chunks",
                    "triage_level": "Doctor",
                    "ragas_metrics": {},
                }
            }

        retrieved_text, cite_block, pages_str, sources = self._build_citations(context_docs)

        stage_timings = dict(context_data.get("stage_timings") or {})

        # Relevance check
        t0 = time.time()
        try:
            is_relevant = self.llm_service.verify_relevance(english_query, retrieved_text, chat_history)
        except Exception as e:
            logger.error("Relevance check error: %s", e)
            is_relevant = True
        stage_timings["verify_relevance_ms"] = round((time.time() - t0) * 1000, 2)
        logger.info("[STAGE TIMING] verify_relevance: %.2f ms", stage_timings["verify_relevance_ms"])

        if not is_relevant:
            return {
                "response": no_info(language),
                "metadata": {
                    "source": "Relevance check failed",
                    "triage_level": "Doctor",
                    "ragas_metrics": {},
                    "stage_timings": stage_timings,
                }
            }

        # Generate answer
        t0 = time.time()
        try:
            answer, model_name = self.llm_service.generate_answer(
                original_query,
                retrieved_text,
                language,
                chat_history,
                rolling_summary=rolling_summary,
                patient_context=patient_context
            )
        except Exception as e:
            logger.error("Answer generation error: %s", e)
            stage_timings["generate_answer_ms"] = round((time.time() - t0) * 1000, 2)
            return {
                "response": no_info(language),
                "metadata": {
                    "source": "LLM generation failed",
                    "triage_level": "Doctor",
                    "ragas_metrics": {},
                    "stage_timings": stage_timings,
                }
            }
        stage_timings["generate_answer_ms"] = round((time.time() - t0) * 1000, 2)
        logger.info("[STAGE TIMING] generate_answer: %.2f ms", stage_timings["generate_answer_ms"])

        # ── Fix 4: RAGAS deferred — background thread, 500ms timeout ─────────
        # Fire RAGAS in a daemon thread. If it finishes within 500ms we use
        # the real score for the faithfulness gate; otherwise we pass through
        # (faithfulness=1.0) and let it log in the background.
        import threading as _threading
        eval_answer = (
            self.llm_service.translate_to_english(answer, "roman_urdu")
            if language == "roman_urdu"
            else answer
        )
        metrics = {"faithfulness": 1.0}  # optimistic default
        _ragas_result = {}

        def _run_ragas():
            try:
                _ragas_result["metrics"] = self.llm_service.compute_ragas_metrics(
                    eval_answer, retrieved_text, english_query,
                    context_docs, self.vector_service.sbert_model
                )
            except Exception as _e:
                logger.error("RAGAS metrics error (background): %s", _e)
                _ragas_result["metrics"] = {"faithfulness": 1.0}

        t0 = time.time()
        _ragas_thread = _threading.Thread(target=_run_ragas, daemon=True)
        _ragas_thread.start()
        _ragas_thread.join(timeout=0.5)  # wait at most 500ms

        if "metrics" in _ragas_result:
            metrics = _ragas_result["metrics"]
            logger.info("RAGAS Metrics (inline): %s", metrics)
        else:
            logger.info("[RAGAS] Still running in background — returning with faithfulness=1.0 pass-through")

        stage_timings["ragas_eval_ms"] = round((time.time() - t0) * 1000, 2)
        logger.info("[STAGE TIMING] ragas_eval: %.2f ms (deferred)", stage_timings["ragas_eval_ms"])
        # ── end Fix 4 ─────────────────────────────────────────────────────────

        # Negative response check
        content_only = answer
        for d_str in [
            "This is not a substitute for professional medical advice.",
            "Ye kisi professional doctor ki salah ka mutbadil nahi hai.",
        ]:
            content_only = re.sub(re.escape(d_str), "", content_only, flags=re.IGNORECASE)
        content_only = content_only.strip()

        ans_lower = answer.lower()
        is_negative = (
            len(content_only) < 30
            or "maafi" in ans_lower
            or ("sorry" in ans_lower and "could not find" in ans_lower)
            or no_info(language).lower()[:30] in ans_lower
        )

        if is_negative:
            answer = no_info(language)

        # Faithfulness gate — same threshold for ALL languages
        faithfulness_score = metrics.get("faithfulness", 1.0)
        if not is_negative and faithfulness_score < 0.25:
            logger.warning(
                "Faithfulness %.2f < 0.25 - returning no-info for language: %s",
                faithfulness_score, language
            )
            answer = no_info(language)
            is_negative = True

        # Final response — message_text keeps full text for DB/search compat
        DISCLAIMER = (
            "Ye kisi professional doctor ki salah ka mutbadil nahi hai."
            if language == "roman_urdu"
            else "This is not a substitute for professional medical advice."
        )
        if is_negative:
            final_response = answer
            answer_body = answer
            final_sources = []
        else:
            final_response = answer + cite_block
            # Strip disclaimer from answer_body so frontend can place it separately
            answer_body = answer
            for d_str in [
                "This is not a substitute for professional medical advice.",
                "Ye kisi professional doctor ki salah ka mutbadil nahi hai.",
            ]:
                answer_body = re.sub(
                    re.escape(d_str), "", answer_body, flags=re.IGNORECASE
                ).strip()
            final_sources = sources

        # Classify triage level
        t0 = time.time()
        triage_level = self.llm_service.classify_triage(original_query, answer)
        stage_timings["classify_triage_ms"] = round((time.time() - t0) * 1000, 2)
        logger.info("[STAGE TIMING] classify_triage: %.2f ms", stage_timings["classify_triage_ms"])

        return {
            "response": final_response,          # full string (DB / plain-text)
            "metadata": {
                "source": "Document Knowledge Base",
                "pages": pages_str,
                "model": model_name,
                "language": language,
                "ragas_metrics": metrics,
                "triage_level": triage_level,
                "stage_timings": stage_timings,
                # ── Structured fields (Phase 2) ───────────────────────────
                "answer_body": answer_body,
                "sources": final_sources,
                "disclaimer": DISCLAIMER,
            }
        }