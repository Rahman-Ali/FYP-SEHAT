import os
import json
import logging
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import auth, credentials

from .models import ChatSession, Message
from .rag_service import RAGService

load_dotenv()
logger = logging.getLogger(__name__)

_firebase_initialized = False


def initialize_firebase_admin():
    """Confirm firebase_admin is initialized once at startup using env configuration."""
    global _firebase_initialized
    if _firebase_initialized or firebase_admin._apps:
        _firebase_initialized = True
        return

    cred = None
    cred_json_env = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    if cred_json_env:
        try:
            cred_dict = json.loads(cred_json_env)
            cred = credentials.Certificate(cred_dict)
            logger.info("Firebase Admin initialized with FIREBASE_SERVICE_ACCOUNT_JSON env var")
        except Exception as e:
            logger.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: %s", e)

    if not cred:
        cred_val = (
            os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY")
            or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
            or os.getenv("FIREBASE_CREDENTIALS_PATH")
        )
        if cred_val:
            cred_val = cred_val.strip().strip('"').strip("'")
            if os.path.isfile(cred_val):
                try:
                    cred = credentials.Certificate(cred_val)
                    logger.info("Firebase Admin initialized with certificate from %s", cred_val)
                except Exception as e:
                    logger.error("Failed to load Firebase credentials from %s: %s", cred_val, e)
            elif cred_val.startswith("{") and cred_val.endswith("}"):
                try:
                    cred_dict = json.loads(cred_val)
                    cred = credentials.Certificate(cred_dict)
                    logger.info("Firebase Admin initialized with JSON certificate from env")
                except Exception as e:
                    logger.error("Failed to parse Firebase certificate JSON: %s", e)

    project_id = os.getenv("FIREBASE_PROJECT_ID", "sehat-538ee")

    try:
        if cred:
            firebase_admin.initialize_app(cred)
        else:
            firebase_admin.initialize_app(options={"projectId": project_id})
            logger.info("Firebase Admin initialized with project ID: %s", project_id)
        _firebase_initialized = True
    except Exception as e:
        logger.warning("Firebase Admin initialization: %s", e)
        _firebase_initialized = True


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

    def verify_firebase_token(self, token: str):
        """
        Verify Firebase ID token sent from the client using firebase_admin SDK.
        Returns: verified uid (str) on success, or None on missing/invalid/expired token.
        """
        if not token or not isinstance(token, str) or not token.strip():
            logger.warning("Firebase token missing or empty")
            return None

        clean_token = token.strip()
        if clean_token.lower().startswith("bearer "):
            clean_token = clean_token[7:].strip()

        # Ensure Firebase Admin is initialized
        initialize_firebase_admin()

        try:
            decoded_token = auth.verify_id_token(clean_token)
            uid = decoded_token.get("uid")
            if uid:
                logger.info("Successfully verified Firebase ID token for UID: %s", uid)
                return uid
            logger.warning("Firebase ID token verification returned no uid in payload")
            return None
        except auth.ExpiredIdTokenError:
            logger.warning("Firebase ID token has expired")
            return None
        except auth.InvalidIdTokenError as e:
            logger.warning("Invalid Firebase ID token: %s", e)
            return None
        except Exception as e:
            logger.error("Firebase ID token verification failed: %s", e)
            return None

    def validate_user(self, firebase_uid):
        return bool(firebase_uid)