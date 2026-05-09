import os
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter


class DocumentService:
    """Handles PDF loading, text chunking, and file deletion."""
    
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
    
    def delete_pdf(self, file_path: str) -> bool:
        """Delete a PDF file from the medical documents directory."""
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                print(f"Deleted file: {file_path}")
                return True
            else:
                print(f"File not found: {file_path}")
                return False
        except Exception as e:
            print(f"Error deleting file: {e}")
            return False
    
    def list_pdf_files(self, directory_path: str) -> list:
        """List all PDF files in the medical documents directory."""
        try:
            if not os.path.exists(directory_path):
                return []
            files = [f for f in os.listdir(directory_path) if f.endswith('.pdf')]
            return files
        except Exception as e:
            print(f"Error listing files: {e}")
            return []