import os
import socket
from dotenv import load_dotenv
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_neo4j import Neo4jVector
from langchain_community.retrievers import BM25Retriever
from sentence_transformers import SentenceTransformer, util
from neo4j import GraphDatabase

load_dotenv()


class VectorStoreService:
    """Manages Neo4j vector store and BM25 retrieval."""
    
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
        """Load embedding models."""
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
        """Test Neo4j connection."""
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
        """Add document chunks to Neo4j vector store and BM25 index."""
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
                print("Added to existing Neo4j index")
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
        """Neo4j Vector + BM25 hybrid search."""
        if not self.is_ready:
            print("Vector store not ready")
            return []

        bm25_docs = []
        if self.sparse_retriever:
            try:
                bm25_docs = self.sparse_retriever.invoke(english_query)
            except Exception as e:
                print(f"BM25 search error: {e}")

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

        scores = {}
        K = 60

        def doc_id(doc):
            return hash((doc.page_content[:200], doc.metadata.get("page", 0)))

        for rank, doc in enumerate(bm25_docs):
            d = doc_id(doc)
            scores[d] = (scores.get(d, (0, doc))[0] + 0.4 / (rank + K), doc)

        for rank, doc in enumerate(neo4j_docs):
            d = doc_id(doc)
            scores[d] = (scores.get(d, (0, doc))[0] + 0.6 / (rank + K), doc)

        seen = set()
        unique_docs = []
        for _, doc in sorted(scores.values(), key=lambda x: x[0], reverse=True):
            d_id = doc_id(doc)
            if d_id not in seen:
                seen.add(d_id)
                unique_docs.append(doc)

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

        if top_score > 0.5:
            threshold = 0.35
        elif top_score > 0.3:
            threshold = 0.25
        else:
            threshold = 0.20

        if top_score < threshold:
            print(f"Top SBERT score {top_score:.3f} < {threshold} - no relevant content")
            return []

        top_chunks = [doc for score, doc in scored if score >= threshold][:5]
        print(f"Retrieved {len(top_chunks)} chunks | top score: {top_score:.3f}")
        return top_chunks