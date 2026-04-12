import os
import socket
from dotenv import load_dotenv

from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_neo4j import Neo4jVector
from langchain_community.retrievers import BM25Retriever
from sentence_transformers import SentenceTransformer, util
from neo4j import GraphDatabase

load_dotenv()


class DocumentService:
   
    
    def load_and_split_pdf(self, pdf_path: str):
      
        loader = PyPDFLoader(pdf_path)
        docs = loader.load()

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=100,
            separators=["\n\n", "\n", ". ", " ", ""],
        )
        chunks = splitter.split_documents(docs)
        
        
        for chunk in chunks:
            chunk.metadata["source_file"] = os.path.basename(pdf_path)
            
        return chunks



class VectorStoreService:
   
    
    def __init__(self):
        self.embeddings_model = None
        self.sbert_model = None
        self.neo4j_vector_store = None
        self.sparse_retriever = None
        self._all_chunks = []
        self.is_ready = False
        
      
        self.NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
        self.NEO4J_USERNAME = os.getenv("NEO4J_USERNAME", "neo4j")
        self.NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")
        self.NEO4J_DATABASE = os.getenv("NEO4J_DATABASE", "neo4j")
        
        self._initialize_models()
        self._test_connection()

    def _initialize_models(self):
       
        try:
            socket.setdefaulttimeout(60)
            self.embeddings_model = HuggingFaceEmbeddings(
                model_name="sentence-transformers/all-MiniLM-L6-v2"
            )
            self.sbert_model = SentenceTransformer("all-MiniLM-L6-v2", device="cpu")
            print("Embedding models loaded successfully")
        except Exception as e:
            print(f"Embedding model load failed: {e}")

    def _test_connection(self):
        
        try:
            driver = GraphDatabase.driver(
                self.NEO4J_URI,
                auth=(self.NEO4J_USERNAME, self.NEO4J_PASSWORD)
            )
            driver.verify_connectivity()
            driver.close()
            print(f"Neo4j connected: {self.NEO4J_URI}")
        except Exception as e:
            print(f"Neo4j connection failed: {e}")
            raise

    def add_chunks_to_store(self, chunks):
        
        
        print(f"Adding {len(chunks)} chunks to Neo4j...")
        
       
        try:
            if self.neo4j_vector_store is None:
                self.neo4j_vector_store = Neo4jVector.from_documents(
                    chunks,
                    self.embeddings_model,
                    url=self.NEO4J_URI,
                    username=self.NEO4J_USERNAME,
                    password=self.NEO4J_PASSWORD,
                    database=self.NEO4J_DATABASE,
                    index_name="medical_docs",
                    node_label="MedicalDocument",
                    embedding_node_property="embedding",
                    text_node_property="text",
                    create_id_index=True,
                )
                print("Created new Neo4j vector index")
            else:
                self.neo4j_vector_store.add_documents(chunks)
                print(f"Added to existing Neo4j index")
        except Exception as e:
            print(f"Neo4j add error: {e}")
            
            try:
                self.neo4j_vector_store = Neo4jVector.from_documents(
                    chunks,
                    self.embeddings_model,
                    url=self.NEO4J_URI,
                    username=self.NEO4J_USERNAME,
                    password=self.NEO4J_PASSWORD,
                    database=self.NEO4J_DATABASE,
                    index_name="medical_docs",
                    node_label="MedicalDocument",
                    embedding_node_property="embedding",
                    text_node_property="text",
                )
                print("Recreated Neo4j vector index")
            except Exception as e2:
                print(f"Neo4j index creation failed: {e2}")

        
        self._all_chunks.extend(chunks)
        self.sparse_retriever = BM25Retriever.from_documents(self._all_chunks)
        self.sparse_retriever.k = 10
        self.is_ready = True
        
        print(f"Total chunks in store: {len(self._all_chunks)}")

    def hybrid_search(self, english_query: str) -> list:
      
        if not self.is_ready:
            print("Vector store not ready")
            return []

       
        bm25_docs = []
        if self.sparse_retriever:
            try:
                bm25_docs = self.sparse_retriever.invoke(english_query)
            except Exception as e:
                print(f"BM25 search error: {e}")

        # Neo4j vector similarity search
        neo4j_docs = []
        if self.neo4j_vector_store:
            try:
                neo4j_docs = self.neo4j_vector_store.similarity_search(
                    english_query,
                    k=10
                )
            except Exception as e:
                print(f"Neo4j search error: {e}")

        print(f"BM25: {len(bm25_docs)} docs, Neo4j: {len(neo4j_docs)} docs")

        # Merge results with Reciprocal Rank Fusion
        scores = {}
        K = 60

        def doc_id(doc):
            return hash((doc.page_content[:200], doc.metadata.get("page", 0)))

        # BM25 scores (weight: 0.4)
        for rank, doc in enumerate(bm25_docs):
            d = doc_id(doc)
            scores[d] = (scores.get(d, (0, doc))[0] + 0.4 / (rank + K), doc)

        # Neo4j vector scores (weight: 0.6)
        for rank, doc in enumerate(neo4j_docs):
            d = doc_id(doc)
            scores[d] = (scores.get(d, (0, doc))[0] + 0.6 / (rank + K), doc)

        # Deduplicate and sort
        seen = set()
        unique_docs = []
        for _, doc in sorted(scores.values(), key=lambda x: x[0], reverse=True):
            d_id = doc_id(doc)
            if d_id not in seen:
                seen.add(d_id)
                unique_docs.append(doc)

        # SBERT Re-ranking
        if not self.sbert_model or not unique_docs:
            return unique_docs[:5]

        q_emb = self.sbert_model.encode(english_query, convert_to_tensor=True)
        scored = []
        for doc in unique_docs:
            d_emb = self.sbert_model.encode(doc.page_content, convert_to_tensor=True)
            score = util.cos_sim(q_emb, d_emb).item()
            scored.append((score, doc))

        scored = sorted(scored, key=lambda x: x[0], reverse=True)
        top_score = scored[0][0] if scored else 0

        # Dynamic threshold
        if top_score > 0.5:
            threshold = 0.35
        elif top_score > 0.3:
            threshold = 0.25
        else:
            threshold = 0.20

        if top_score < threshold:
            print(f"⚠️ Top SBERT score {top_score:.3f} < {threshold} — no relevant content")
            return []

        top_chunks = [doc for score, doc in scored if score >= threshold][:5]
        print(f"✅ Retrieved {len(top_chunks)} chunks | top score: {top_score:.3f}")
        return top_chunks



class LLMService:

    
    def __init__(self):
        self.GROQ_API_KEY = os.getenv("GROQ_API_KEY")
        if not self.GROQ_API_KEY:
            raise RuntimeError("GROQ_API_KEY missing in .env file")

        self.llm = ChatGroq(
            model_name="llama-3.1-8b-instant",
            groq_api_key=self.GROQ_API_KEY,
            temperature=0.2,
            max_tokens=1024,
            timeout=30,
            max_retries=2,
        )

    def validate_query(self, query: str) -> str:
        if not query.strip():
            return "invalid"
            
        prompt = f"""You are a query classifier for a medical information system.

VALID   — The message clearly asks about a health topic, symptom, disease, or treatment.
UNCLEAR — The message is health-related but too vague to search.
INVALID — The message is a greeting, random text, or not about health.

Output ONLY one word: VALID, UNCLEAR, or INVALID

User message: {query}

Classification:"""
        try:
            resp = self.llm.invoke(prompt)
            result = (resp.content if hasattr(resp, "content") else str(resp)).strip().upper()
            word = result.split()[0] if result.split() else "UNCLEAR"
            if word in ("VALID", "UNCLEAR", "INVALID"):
                print(f"Validation: {word}")
                return word.lower()
            return "unclear"
        except Exception as e:
            print(f"Validation error: {e}")
            return "unclear"

    def detect_language(self, query: str) -> str:
        hindi_chars = ['ा', 'ि', 'ी', 'ु', 'ू', 'े', 'ै', 'ो', 'ौ', 'ं', 'ः', 'ँ']
        
        if any(char in query for char in hindi_chars):
            print("Hindi detected — language not supported")
            return "invalid_hindi"
        
        prompt = f"""Determine the EXACT language of this text.

Rules:
- If text contains Urdu words written in English alphabet (like: hai, hain, mera, aapka, kya, etc.) → roman_urdu
- If text is pure English → english

Output ONLY ONE WORD: roman_urdu OR english

Text: {query}

Language:"""
        try:
            resp = self.llm.invoke(prompt)
            result = (resp.content if hasattr(resp, "content") else str(resp)).strip().lower()
            
            if "urdu" in result or "roman" in result:
                print("Language: Roman Urdu")
                return "roman_urdu"
            else:
                print("Language: English")
                return "english"
        except Exception as e:
            print(f"Language detection error: {e}")
            return "english"

    def translate_to_english(self, query: str, language: str) -> str:
        if language == "english":
            return query
        if language == "invalid_hindi":
            return query

        prompt = f"""Translate this Roman Urdu medical query into accurate English.
Preserve all symptoms, conditions, and medical details.

Roman Urdu: {query}

English translation:"""
        try:
            resp = self.llm.invoke(prompt)
            translation = (resp.content if hasattr(resp, "content") else str(resp)).strip()
            if translation and len(translation) > 2:
                print(f"Translated: '{query}' → '{translation}'")
                return translation
            return query
        except Exception as e:
            print(f"Translation error: {e}")
            return query

    def verify_relevance(self, english_query: str, retrieved_text: str) -> bool:
        prompt = f"""You are a relevance checker.

Question: {english_query}

Retrieved Text:
{retrieved_text[:1500]}

Does the retrieved text contain information that answers the question?

Output ONLY: YES or NO

Relevant?"""
        try:
            resp = self.llm.invoke(prompt)
            result = (resp.content if hasattr(resp, "content") else str(resp)).strip().upper()
            is_relevant = result.startswith("YES")
            print(f"🔍 Relevance: {'✅ YES' if is_relevant else '❌ NO'}")
            return is_relevant
        except Exception as e:
            print(f"⚠️ Relevance check error: {e}")
            return True

    def generate_answer(self, original_query: str, retrieved_text: str, language: str) -> str:
        if language == "invalid_hindi":
            return ("Please ask your question in English or Roman Urdu. "
                    "Hindi (Devanagari script) is not supported.\n\n"
                    "Baraye meharbani apna sawaal English ya Roman Urdu mein poochein.")

        if language == "roman_urdu":
            lang_rule = """IMPORTANT: Write the ENTIRE answer in Roman Urdu (Urdu using English alphabet).
Use words like: hai, hain, ka, ki, mein, aap, aapka, etc."""
            no_info_msg = ("Maafi chahta hoon, is sawaal ka jawab mere paas mojood documents "
                          "mein nahi mila. Kisi doctor se rabta karein.")
        else:
            lang_rule = """IMPORTANT: Write the ENTIRE answer in clear English."""
            no_info_msg = ("Sorry, I could not find information about this in my knowledge base. "
                          "Please consult a doctor.")

        prompt = f"""You are a helpful medical assistant. {lang_rule}

Information from medical documents:
{retrieved_text}

User's question: {original_query}

CRITICAL INSTRUCTIONS:
1. Read the question carefully. Identify ALL parts/symptoms mentioned.
2. Answer EVERY part of the question.
3. Use ONLY the information provided above.
4. Rewrite in simple, easy-to-understand language.
5. If the information does NOT answer the question, output EXACTLY: {no_info_msg}
6. Do NOT introduce yourself.
7. Use bullet points (dash -) for clarity. Maximum 5-6 points.

Answer:"""
        try:
            resp = self.llm.invoke(prompt)
            answer = (resp.content if hasattr(resp, "content") else str(resp)).strip()
            answer = answer.replace("**", "").replace("##", "").replace("__", "")
            
            # Language verification
            if language == "english":
                urdu_markers = [" hai ", " hain ", " ka ", " ki ", " mein ", " aap "]
                answer_lower = " " + answer.lower() + " "
                urdu_count = sum(1 for marker in urdu_markers if marker in answer_lower)
                if urdu_count >= 2:
                    print(f"⚠️ Language mismatch: English expected but got Urdu markers")
                    return no_info_msg
            
            return answer
        except Exception as e:
            print(f"⚠️ Generation error: {e}")
            return no_info_msg

    def compute_ragas_metrics(self, answer: str, retrieved_text: str, 
                               query: str, context_docs: list, sbert_model) -> dict:
        zero = {k: 0.0 for k in ["faithfulness", "answer_relevancy", 
                                  "context_recall", "context_precision", "answer_correctness"]}
        if not sbert_model:
            return zero
            
        try:
            enc = sbert_model.encode
            
            sentences = [s.strip() for s in answer.replace('\n', '.').split(".") if len(s.strip()) > 10]
            if sentences:
                ctx_emb = enc(retrieved_text)
                supported = sum(1 for s in sentences if util.cos_sim(enc(s), ctx_emb).item() > 0.35)
                faithfulness = supported / len(sentences)
            else:
                faithfulness = 0.0

            ans_rel = util.cos_sim(enc(query), enc(answer)).item()
            ctx_rec = util.cos_sim(enc(retrieved_text), enc(answer)).item()
            chunk_sims = [util.cos_sim(enc(query), enc(d.page_content)).item() for d in context_docs]
            ctx_prec = sum(chunk_sims) / len(chunk_sims) if chunk_sims else 0.0
            ans_corr = max((util.cos_sim(enc(answer), enc(d.page_content)).item() for d in context_docs), default=0.0)

            return {
                "faithfulness": round(faithfulness, 2),
                "answer_relevancy": round(ans_rel, 2),
                "context_recall": round(ctx_rec, 2),
                "context_precision": round(ctx_prec, 2),
                "answer_correctness": round(ans_corr, 2),
            }
        except Exception as e:
            print(f"⚠️ RAGAS metrics error: {e}")
            return zero



class RAGService:
  
    
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
            print(f"Faithfulness {metrics['faithfulness']:.2f} < 0.25 — returning no-info.")
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