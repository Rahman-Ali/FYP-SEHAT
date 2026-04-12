from .models import ChatSession, Message
from .rag_service import RAGService


class ChatService:
   
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
    
    def process_user_query(self, session_id, query):
       
        session = ChatSession.objects.get(id=session_id)
        
        user_msg = Message.objects.create(
            session=session,
            sender='user',
            message_text=query
        )
        
        context = self.rag_service.retrieve_context(query)
        response = self.rag_service.generate_with_context(query, context)
        
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


class AuthenticationService:
   
    def verify_firebase_token(self, token):
        pass
    
    def validate_user(self, firebase_uid):
        return bool(firebase_uid)