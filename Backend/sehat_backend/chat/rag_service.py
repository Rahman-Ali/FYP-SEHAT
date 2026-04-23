import os
from dotenv import load_dotenv
from .document_service import DocumentService
from .vector_store_service import VectorStoreService
from .llm_service import LLMService

load_dotenv()


class RAGService:
    """Main coordinator that connects Document, VectorStore, and LLM services."""
    
    def __init__(self):
        self.doc_service = DocumentService()
        self.vector_service = VectorStoreService()
        self.llm_service = LLMService()

    def load_document(self, pdf_path: str, book_name: str) -> str:
        """Load a PDF document into the RAG system."""
        try:
            print(f"Loading: {pdf_path}")
            chunks = self.doc_service.load_and_split_pdf(pdf_path)
            self.vector_service.add_chunks_to_store(chunks)
            print(f"'{book_name}': {len(chunks)} chunks | Total: {len(self.vector_service._all_chunks)} chunks")
            return f"Loaded {len(chunks)} chunks from '{book_name}'"
        except Exception as e:
            print(f"Failed to load '{book_name}': {e}")
            return f"Error: {e}"

    def retrieve_context(self, query: str) -> dict:
        """Steps 1-4 of RAG pipeline."""
        
        status = self.llm_service.validate_query(query)
        
        base_response = {
            "status": status,
            "chunks": [],
            "language": "english",
            "english_query": query,
            "original_query": query
        }

        if status in ("invalid", "unclear"):
            return base_response

        if not self.vector_service.is_ready:
            print("No documents loaded.")
            return base_response

        language = self.llm_service.detect_language(query)
        
        if language == "invalid_hindi":
            base_response["status"] = "invalid_hindi"
            base_response["language"] = language
            return base_response

        english_query = self.llm_service.translate_to_english(query, language)
        chunks = self.vector_service.hybrid_search(english_query)

        base_response.update({
            "chunks": chunks,
            "language": language,
            "english_query": english_query
        })
        
        return base_response

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
                    page_num = page
                citations_dict.setdefault(book_name, set()).add(page_num)

        retrieved_text = "\n\n".join(blocks)
        pages_str = ", ".join(map(str, sorted(set(pages)))) if pages else "Unknown"

        cite = ""
        if citations_dict:
            cite = "\n\n--- Sources ---\n"
            for book in sorted(citations_dict):
                sp = sorted(citations_dict[book], key=lambda x: (isinstance(x, str), x))
                cite += f"{book}: Pages {', '.join(str(p) for p in sp)}\n"
        
        return retrieved_text, cite, pages_str

    def generate_with_context(self, query: str, context_data: dict) -> dict:
        """Steps 5-6 of RAG pipeline."""
        
        def no_info(lang):
            if lang == "roman_urdu":
                return ("Maafi chahta hoon, is sawaal ka jawab mere paas mojood documents "
                       "mein nahi mila. Kisi doctor se rabta karein.")
            return ("Sorry, I could not find information about this in my knowledge base. "
                   "Please consult a doctor.")

        st = context_data.get("status", "valid")
        
        if st == "invalid":
            return {
                "response": "Please ask a health-related question.\n\nBaraye meharbani sehat se mutaliq sawaal poochein.",
                "metadata": {"source": "Validation", "ragas_metrics": {}}
            }
        if st == "unclear":
            return {
                "response": "Could you describe your symptoms or concern in more detail?\n\nApni takleef thodi aur detail mein batayein.",
                "metadata": {"source": "Validation", "ragas_metrics": {}}
            }
        if st == "invalid_hindi":
            return {
                "response": ("Please ask your question in English or Roman Urdu. "
                            "Hindi (Devanagari script) is not supported.\n\n"
                            "Baraye meharbani apna sawaal English ya Roman Urdu mein poochein."),
                "metadata": {"source": "Validation", "ragas_metrics": {}}
            }

        context_docs = context_data.get("chunks", [])
        language = context_data.get("language", "english")
        english_query = context_data.get("english_query", query)
        original_query = context_data.get("original_query", query)

        if not context_docs:
            return {
                "response": no_info(language),
                "metadata": {"source": "No relevant chunks", "ragas_metrics": {}}
            }

        retrieved_text, cite_block, pages_str = self._build_citations(context_docs)

        if not self.llm_service.verify_relevance(english_query, retrieved_text):
            return {
                "response": no_info(language),
                "metadata": {"source": "Relevance check failed", "ragas_metrics": {}}
            }

        answer = self.llm_service.generate_answer(original_query, retrieved_text, language)

        eval_answer = self.llm_service.translate_to_english(answer, "roman_urdu") if language == "roman_urdu" else answer
        
        metrics = self.llm_service.compute_ragas_metrics(
            eval_answer, retrieved_text, english_query, context_docs, 
            self.vector_service.sbert_model
        )
        print(f"\nRAGAS Metrics: {metrics}")

        ans_lower = answer.lower()
        is_negative = ("maafi" in ans_lower) or ("sorry" in ans_lower and "could not find" in ans_lower)

        if is_negative:
            answer = no_info(language)
        
        if not is_negative and metrics.get("faithfulness", 0) < 0.25:
            print(f"Faithfulness {metrics['faithfulness']:.2f} < 0.25 - returning no-info.")
            answer = no_info(language)
            is_negative = True

        final_response = answer if is_negative else answer + cite_block

        return {
            "response": final_response,
            "metadata": {
                "source": "Document Knowledge Base (Neo4j)",
                "pages": pages_str,
                "model": "Groq Llama 3.1 8B",
                "language": language,
                "ragas_metrics": metrics
            }
        }