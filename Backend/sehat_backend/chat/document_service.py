import os
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter


class DocumentService:
    """Handles PDF loading and text chunking."""
    
    def load_and_split_pdf(self, pdf_path: str):
        """Load PDF and split into chunks."""
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