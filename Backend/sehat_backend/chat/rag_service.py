import os
import re
import logging
from dotenv import load_dotenv
from .document_service import DocumentService
from .vector_store_service import VectorStoreService
from .llm_service import LLMService

load_dotenv()

logger = logging.getLogger(__name__)


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
        """Load a PDF document into the RAG system."""
        try:
            logger.info("Loading document: %s", pdf_path)
            chunks = self.doc_service.load_and_split_pdf(pdf_path)
            self.vector_service.add_chunks_to_store(chunks)
            logger.info(
                "'%s': %d chunks | Total: %d chunks",
                book_name, len(chunks), len(self.vector_service._all_chunks)
            )
            return f"Loaded {len(chunks)} chunks from '{book_name}'"
        except Exception as e:
            logger.error("Failed to load '%s': %s", book_name, e)
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
                    "chunk_count": neo4j_info["chunk_count"] if neo4j_info else 0
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

    # ========================================================================
    # CONTEXT RETRIEVAL
    # ========================================================================

    def retrieve_context(self, query: str, chat_history: list = None) -> dict:
        """Steps 1-4 of RAG pipeline with emergency detection + query rewriting."""
        
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
        """Build retrieved text and citation block."""
        blocks = []
        pages = []
        citations_dict = {}

        for i, doc in enumerate(context_docs, 1):
            blocks.append(f"[{i}] {doc.page_content.strip()}")
            page = doc.metadata.get("page", "Unknown")
            source_path = doc.metadata.get("source", "Unknown")
            book_name = os.path.basename(str(source_path))

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

        cite = ""
        if citations_dict:
            cite = "\n\n--- Sources ---\n"
            for book in sorted(citations_dict):
                sp = sorted(
                    citations_dict[book],
                    key=lambda x: (isinstance(x, str), str(x))
                )
                cite += f"{book}: Pages {', '.join(str(p) for p in sp)}\n"

        return retrieved_text, cite, pages_str

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
                    "metadata": {"source": "Emergency", "ragas_metrics": {}}
                }
            return {
                "response": (
                    "⚠️ Emergency: If you're thinking about self-harm or suicide, "
                    "please seek help immediately. In Pakistan, call 1122 for "
                    "emergency services. You are not alone — please reach out "
                    "to a doctor or loved one."
                ),
                "metadata": {"source": "Emergency", "ragas_metrics": {}}
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
                "metadata": {"source": "No relevant chunks", "ragas_metrics": {}}
            }

        retrieved_text, cite_block, pages_str = self._build_citations(context_docs)

        # Relevance check
        try:
            is_relevant = self.llm_service.verify_relevance(english_query, retrieved_text, chat_history)
        except Exception as e:
            logger.error("Relevance check error: %s", e)
            is_relevant = True

        if not is_relevant:
            return {
                "response": no_info(language),
                "metadata": {"source": "Relevance check failed", "ragas_metrics": {}}
            }

        # Generate answer
        try:
            answer = self.llm_service.generate_answer(
            original_query,
            retrieved_text,
            language,
            chat_history  
        )
        except Exception as e:
            logger.error("Answer generation error: %s", e)
            return {
                "response": no_info(language),
                "metadata": {"source": "LLM generation failed", "ragas_metrics": {}}
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
        ans_lower = answer.lower()
        is_negative = (
            "maafi" in ans_lower
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

        # Final response
        final_response = answer if is_negative else answer + cite_block

        return {
            "response": final_response,
            "metadata": {
                "source": "Document Knowledge Base",
                "pages": pages_str,
                "model": "GPT-4o" if self.llm_service.OPENAI_API_KEY else "Groq Llama 3.1 8B",
                "language": language,
                "ragas_metrics": metrics
            }
        }