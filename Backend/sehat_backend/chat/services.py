from .models import ChatSession, Message
from .rag_service import RAGService


class ChatService:
    """Business logic for chat operations."""
    
    def __init__(self):
        self.rag_service = RAGService()
    
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
    
    # backend/chat/services.py

    def process_user_query(self, session_id, query, chat_history=None):
        """Process user query through RAG pipeline with memory support."""
        session = ChatSession.objects.get(id=session_id)
        
        user_msg = Message.objects.create(
            session=session,
            sender='user',
            message_text=query
        )
        
        # [MEMORY] Use frontend history if provided, else fetch from DB
        if not chat_history:
            previous_messages = Message.objects.filter(
                session=session
            ).order_by('-timestamp')[:10]
            
            chat_history = []
            for msg in reversed(list(previous_messages)):
                chat_history.append({
                    "sender": msg.sender,
                    "text": msg.message_text
                })
        
        # Ensure correct format
        formatted_history = []
        for msg in (chat_history or [])[-6:]:
            formatted_history.append({
                "sender": msg.get("sender", "user"),
                "text": msg.get("text", msg.get("message_text", ""))
            })
        
        print(f"[MEMORY] History messages: {len(formatted_history)}")
        for i, msg in enumerate(formatted_history):
            print(f"[MEMORY]   [{i}] {msg['sender']}: {msg['text'][:50]}...")
        
        context = self.rag_service.retrieve_context(query, formatted_history)
        response = self.rag_service.generate_with_context(query, context, formatted_history)
        
        bot_msg = Message.objects.create(
            session=session,
            sender='bot',
            message_text=response['response'],
            metadata=response.get('metadata', {})
        )
        
        session.save()
        
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
    
    def verify_firebase_token(self, token):
        pass
    
    def validate_user(self, firebase_uid):
        return bool(firebase_uid)