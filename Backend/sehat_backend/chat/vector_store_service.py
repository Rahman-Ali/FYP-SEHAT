import os
import socket
import logging
from dotenv import load_dotenv
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_neo4j import Neo4jVector
from langchain_community.retrievers import BM25Retriever
from sentence_transformers import SentenceTransformer, util
from neo4j import GraphDatabase

load_dotenv()

logger = logging.getLogger(__name__)


class VectorStoreService:
    """Manages Neo4j vector store and BM25 retrieval."""
    
    def __init__(self):
        self.embeddings_model = None
        self.sbert_model = None
        self.neo4j_vector_store = None
        self.sparse_retriever = None
        self._all_chunks = []
        self.is_ready = False
        
        self.NEO4J_URI = os.getenv(
        "NEO4J_URI",
        "neo4j+s://98b70f75.databases.neo4j.io"
)
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

    def warm_up_bm25_from_neo4j(self):
        """Rebuild the in-memory BM25 index from all text stored in Neo4j.

        Called after the startup ingestion loop so that files skipped by the
        hash-check still have their text available for BM25 retrieval.
        If _all_chunks is already populated (from files that were actually
        re-ingested this run) this adds the skipped files' text on top.
        """
        try:
            driver = GraphDatabase.driver(
                self.NEO4J_URI,
                auth=(self.NEO4J_USERNAME, self.NEO4J_PASSWORD),
            )
            with driver.session(database=self.NEO4J_DATABASE) as session:
                result = session.run(
                    "MATCH (n:MedicalDocument) "
                    "RETURN n.text AS text, n.source_file AS source_file, "
                    "n.page AS page, n.disease AS disease"
                )
                from langchain_core.documents import Document as LC_Document
                loaded_source_files = {
                    c.metadata.get("source_file") for c in self._all_chunks
                }
                new_chunks = []
                for record in result:
                    sf = record["source_file"]
                    if sf not in loaded_source_files:
                        new_chunks.append(
                            LC_Document(
                                page_content=record["text"] or "",
                                metadata={
                                    "source_file": sf,
                                    "page": record["page"],
                                    "disease": record.get("disease"),
                                },
                            )
                        )
            driver.close()

            if new_chunks:
                self._all_chunks.extend(new_chunks)
                print(
                    f"[BM25 warm-up] loaded {len(new_chunks)} chunks from Neo4j "
                    f"(skipped-file text)"
                )

            if self._all_chunks:
                self.sparse_retriever = BM25Retriever.from_documents(self._all_chunks)
                self.sparse_retriever.k = 10
                self.is_ready = True
                print(
                    f"[BM25 warm-up] index ready — "
                    f"{len(self._all_chunks)} total chunks"
                )
                # Attach neo4j_vector_store so vector search works this session
                self._attach_neo4j_store_if_needed()
        except Exception as e:
            print(f"[BM25 warm-up] failed: {e}")

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

    def _attach_neo4j_store_if_needed(self):
        """Connect to the EXISTING Neo4j vector index without inserting any data.

        Called after BM25 warm-up (skip-all sessions) so that vector search
        works even when add_chunks_to_store was never invoked this run.
        Also called lazily at the top of hybrid_search as a safety net.
        """
        if self.neo4j_vector_store is not None:
            return  # already attached
        try:
            self.neo4j_vector_store = Neo4jVector.from_existing_index(
                self.embeddings_model,
                index_name="medical_docs",
                url=self.NEO4J_URI,
                username=self.NEO4J_USERNAME,
                password=self.NEO4J_PASSWORD,
                database=self.NEO4J_DATABASE,
            )
            print("[Neo4j] attached to existing index 'medical_docs' (no data written)")
        except Exception as e:
            print(f"[Neo4j] could not attach to existing index: {e}")

    def delete_chunks_by_source(self, source_file: str) -> int:
        """Delete all chunks from Neo4j that belong to a specific source file."""
        try:
            driver = GraphDatabase.driver(
                self.NEO4J_URI,
                auth=(self.NEO4J_USERNAME, self.NEO4J_PASSWORD)
            )
            with driver.session(database=self.NEO4J_DATABASE) as session:
                # Match by source_file property
                result = session.run(
                    "MATCH (n:MedicalDocument) "
                    "WHERE n.source_file = $source "
                    "DETACH DELETE n "
                    "RETURN count(n) AS deleted_count",
                    source=source_file
                )
                record = result.single()
                deleted_count = record["deleted_count"] if record else 0
                
                print(f"Deleted {deleted_count} chunks from Neo4j for: {source_file}")
                
                # If 0 deleted, try alternate query with source file in text
                if deleted_count == 0:
                    result2 = session.run(
                        "MATCH (n:MedicalDocument) "
                        "WHERE n.text CONTAINS $source "
                        "DETACH DELETE n "
                        "RETURN count(n) AS deleted_count",
                        source=source_file
                    )
                    record2 = result2.single()
                    deleted_count = record2["deleted_count"] if record2 else 0
                    print(f"Alternate query deleted {deleted_count} chunks for: {source_file}")
            
            driver.close()
            
            # Update local BM25 index
            self._all_chunks = [
                chunk for chunk in self._all_chunks 
                if chunk.metadata.get("source_file") != source_file
            ]
            
            if self._all_chunks:
                self.sparse_retriever = BM25Retriever.from_documents(self._all_chunks)
                self.sparse_retriever.k = 10
            
            return deleted_count

        except Exception as e:
            print(f"Error deleting chunks from Neo4j: {e}")
            return 0

    def get_source_hash(self, source_file: str) -> str | None:
        """Return the SHA-256 hash stored on any existing chunk for source_file.

        Returns None if no chunks exist yet or if no hash property is set.
        """
        try:
            driver = GraphDatabase.driver(
                self.NEO4J_URI,
                auth=(self.NEO4J_USERNAME, self.NEO4J_PASSWORD),
            )
            with driver.session(database=self.NEO4J_DATABASE) as session:
                result = session.run(
                    "MATCH (n:MedicalDocument) "
                    "WHERE n.source_file = $source "
                    "RETURN n.source_hash AS h LIMIT 1",
                    source=source_file,
                )
                record = result.single()
                stored_hash = record["h"] if record else None
            driver.close()
            return stored_hash
        except Exception as e:
            print(f"Error reading source_hash for '{source_file}': {e}")
            return None

    def get_document_list(self) -> list:
    
        try:
            # Retry connection if dropped
            try:
                driver = GraphDatabase.driver(
                    self.NEO4J_URI,
                    auth=(self.NEO4J_USERNAME, self.NEO4J_PASSWORD)
                )
                driver.verify_connectivity()
            except:
                print("Neo4j connection lost, retrying...")
                self._test_connection()
                driver = GraphDatabase.driver(
                    self.NEO4J_URI,
                    auth=(self.NEO4J_USERNAME, self.NEO4J_PASSWORD)
                )
            
            with driver.session(database=self.NEO4J_DATABASE) as session:
                result = session.run(
                    "MATCH (n:MedicalDocument) "
                    "RETURN DISTINCT n.source_file AS source_file, "
                    "count(n) AS chunk_count, "
                    "head(collect(n.disease)) AS disease"
                )
                documents = []
                for record in result:
                    documents.append({
                        "source_file": record["source_file"],
                        "chunk_count": record["chunk_count"],
                        "disease": record.get("disease"),
                    })
            driver.close()
            return documents
        except Exception as e:
            print(f"Error getting document list: {e}")
            return []

    def hybrid_search(self, english_query: str) -> list:
        if not self.is_ready:
            print("Vector store not ready")
            return []

        # Lazy-attach: covers the case where warm_up ran but the attach call
        # failed silently, or if the caller bypasses warm_up entirely.
        self._attach_neo4j_store_if_needed()

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
            docs_to_return = unique_docs[:5]
            for doc in docs_to_return:
                if not doc.metadata.get("disease"):
                    logger.warning(
                        "Retrieved chunk from '%s' (page %s) lacks a 'disease' metadata tag",
                        doc.metadata.get("source_file"),
                        doc.metadata.get("page"),
                    )
            return docs_to_return

        q_emb = self.sbert_model.encode(english_query, convert_to_tensor=True)
        scored = []
        for doc in unique_docs:
            d_emb = self.sbert_model.encode(doc.page_content, convert_to_tensor=True)
            score = util.cos_sim(q_emb, d_emb).item()
            scored.append((score, doc))

        scored = sorted(scored, key=lambda x: x[0], reverse=True)
        top_score = scored[0][0] if scored else 0

        if top_score < 0.48:
            print(f"Top SBERT score {top_score:.3f} < 0.48 - no relevant content")
            return []

        if top_score > 0.5:
            threshold = 0.35
        elif top_score > 0.3:
            threshold = 0.35
        else:
            threshold = 0.35

        if top_score < threshold:
            print(f"Top SBERT score {top_score:.3f} < {threshold} - no relevant content")
            return []

        top_chunks = [doc for score, doc in scored if score >= threshold][:5]
        print(f"Retrieved {len(top_chunks)} chunks | top score: {top_score:.3f}")
        for chunk in top_chunks:
            if not chunk.metadata.get("disease"):
                logger.warning(
                    "Retrieved chunk from '%s' (page %s) lacks a 'disease' metadata tag",
                    chunk.metadata.get("source_file"),
                    chunk.metadata.get("page"),
                )
        return top_chunks