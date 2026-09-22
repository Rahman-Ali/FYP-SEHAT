import os
import re
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

    def _needs_clarification(self, query: str, chat_history: list = None) -> tuple:
        """Check whether a query is too vague to produce a useful answer.

        Returns (needs_clarification: bool, follow_up_question: str).
        Only fires when the query is valid but under-specified (e.g. 'I feel sick'
        with no history).  Uses the Aux LLM with a structured prompt.
        """
        # Skip for queries with enough context (long queries or rich history)
        if len(query.split()) >= 10:
            return False, ""
        if chat_history and len(chat_history) >= 4:
            # Enough history already — let retrieval proceed
            return False, ""

        history_text = ""
        if chat_history:
            for msg in chat_history[-4:]:
                sender = "User" if msg.get("sender") == "user" else "Assistant"
                text = msg.get("text", msg.get("message_text", ""))
                if text.strip():
                    history_text += f"{sender}: {text}\n"

        prompt = f"""You are a medical chatbot triage assistant.

Conversation so far:
{history_text if history_text else 'No previous conversation.'}

User message: {query}

Decide whether this query is too vague to give a specific, helpful medical
answer without more information. Consider it NEEDS_CLARIFICATION if:
- It mentions only general feelings without specifying a body part, symptom,
  or disease (e.g. 'I feel sick', 'I am unwell', 'I have a problem')
- AND the conversation history doesn't already clarify the topic.

If it NEEDS_CLARIFICATION, reply in this exact format:
NEEDS_CLARIFICATION: <ONE single follow-up question in the same language as the user's message>

Otherwise reply ONLY: SUFFICIENT

Do not explain. Output exactly one of these two formats."""

        try:
            resp = self.llm_service._call_aux_llm(prompt).strip()
            if resp.upper().startswith("NEEDS_CLARIFICATION:"):
                question = resp.split(":", 1)[1].strip()
                if question:
                    return True, question
        except Exception as e:
            logger.error("Clarification check error: %s", e)
        return False, ""

    # ========================================================================
    # CONTEXT RETRIEVAL
    # ========================================================================

    def retrieve_context(
        self, query: str, chat_history: list = None,
        clarification_round: int = 0
    ) -> dict:
        """Steps 1-4 of RAG pipeline with emergency detection + query rewriting.

        Args:
            clarification_round: Number of clarifying questions already asked
                for this session.  If < 5 and the query is under-specified,
                returns status='clarifying' with a follow-up question.
                On round 5 the clarification gate is skipped and full retrieval
                is forced regardless (hard cap).
        """
        # Run security check first
        sanitize_result = self.llm_service.sanitize_input(query)
        if sanitize_result.get('is_emergency'):
            return {
                "status": "emergency",
                "chunks": [],
                "language": "english",
                "english_query": query,
                "original_query": query
            }

        status = self.llm_service.validate_query(query)
        
        # [NEW] Rewrite query for better retrieval
        rewritten_query = query
        if status == "valid" and chat_history:
            rewritten_query = self.llm_service.rewrite_query(query, chat_history)

        language = self.llm_service.detect_language(query)

        base_response = {
            "status": status,
            "chunks": [],
            "language": language,
            "english_query": rewritten_query,
            "original_query": query
        }

        if status in ("invalid", "unclear", "greeting"):
            return base_response

        if not self.vector_service.is_ready:
            logger.warning("Vector store not ready")
            return base_response

        if language == "invalid_hindi":
            base_response["status"] = "invalid_hindi"
            base_response["language"] = language
            return base_response

        # ── Phase 3: Clarification gate ──────────────────────────────────────
        # Fire only when round < 5 (hard cap: on round 5 force full retrieval)
        if status == "valid" and clarification_round < 5:
            needs_clarify, follow_up = self._needs_clarification(
                rewritten_query, chat_history
            )
            if needs_clarify:
                logger.info(
                    "Clarification needed (round %d): '%s'",
                    clarification_round + 1, follow_up
                )
                return {
                    "status": "clarifying",
                    "chunks": [],
                    "language": language,
                    "english_query": rewritten_query,
                    "original_query": query,
                    "follow_up_question": follow_up,
                }

        english_query = self.llm_service.translate_to_english(rewritten_query, language)
        chunks = self.vector_service.hybrid_search(english_query)

        base_response.update({
            "chunks": chunks,
            "language": language,
            "english_query": english_query
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
            for book in sorted(citations_dict):
                title = title_map.get(book, book)
                sp = sorted(
                    citations_dict[book],
                    key=lambda x: (isinstance(x, str), str(x))
                )
                cite += f"{title}: Pages {', '.join(str(p) for p in sp)}\n"

        # Structured sources list for the API response metadata
        sources = []
        for book in sorted(citations_dict):
            sp = sorted(
                citations_dict[book],
                key=lambda x: (isinstance(x, str), str(x))
            )
            sources.append({
                "title": title_map.get(book, book),
                "filename": book,
                "pages": [str(p) for p in sp],
            })

        return retrieved_text, cite, pages_str, sources

    # ========================================================================
    # MAIN GENERATION FLOW
    # ========================================================================

    def generate_with_context(
        self, query: str, context_data: dict, chat_history: list = None
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
        # BRANCH 1: EMERGENCY
        # ══════════════════════════════════════════════════════════════
        if st == "emergency":
            if language == "roman_urdu":
                return {
                    "response": (
                        "⚠️ Emergency: Agar aap self-harm ya suicide ke baare mein "
                        "soch rahe hain, to please turant madad lein. Pakistan mein "
                        "emergency helpline 1122 hai. Ya apne qareebi doctor se "
                        "rabta karein. Aap akele nahi hain."
                    ),
                    "metadata": {
                        "source": "Emergency",
                        "triage_level": "Emergency",
                        "ragas_metrics": {},
                    }
                }
            return {
                "response": (
                    "⚠️ Emergency: If you're thinking about self-harm or suicide, "
                    "please seek help immediately. In Pakistan, call 1122 for "
                    "emergency services. You are not alone — please reach out "
                    "to a doctor or loved one."
                ),
                "metadata": {
                    "source": "Emergency",
                    "triage_level": "Emergency",
                    "ragas_metrics": {},
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

        # Relevance check
        try:
            is_relevant = self.llm_service.verify_relevance(english_query, retrieved_text, chat_history)
        except Exception as e:
            logger.error("Relevance check error: %s", e)
            is_relevant = True

        if not is_relevant:
            return {
                "response": no_info(language),
                "metadata": {
                    "source": "Relevance check failed",
                    "triage_level": "Doctor",
                    "ragas_metrics": {},
                }
            }

        # Generate answer
        try:
            answer, model_name = self.llm_service.generate_answer(
                original_query,
                retrieved_text,
                language,
                chat_history  
            )
        except Exception as e:
            logger.error("Answer generation error: %s", e)
            return {
                "response": no_info(language),
                "metadata": {
                    "source": "LLM generation failed",
                    "triage_level": "Doctor",
                    "ragas_metrics": {},
                }
            }

        # Compute metrics
        eval_answer = (
            self.llm_service.translate_to_english(answer, "roman_urdu")
            if language == "roman_urdu"
            else answer
        )

        try:
            metrics = self.llm_service.compute_ragas_metrics(
                eval_answer, retrieved_text, english_query,
                context_docs, self.vector_service.sbert_model
            )
        except Exception as e:
            logger.error("RAGAS metrics error: %s", e)
            metrics = {"faithfulness": 1.0}

        logger.info("RAGAS Metrics: %s", metrics)

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
        triage_level = self.llm_service.classify_triage(original_query, answer)

        return {
            "response": final_response,          # full string (DB / plain-text)
            "metadata": {
                "source": "Document Knowledge Base",
                "pages": pages_str,
                "model": model_name,
                "language": language,
                "ragas_metrics": metrics,
                "triage_level": triage_level,
                # ── Structured fields (Phase 2) ───────────────────────────
                "answer_body": answer_body,
                "sources": final_sources,
                "disclaimer": DISCLAIMER,
            }
        }