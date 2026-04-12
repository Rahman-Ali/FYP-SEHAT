import os
from pathlib import Path
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.shortcuts import get_object_or_404
from django.http import Http404

from .models import ChatSession, Message
from .serializers import (
    ChatSessionSerializer,
    ChatSessionDetailSerializer,
    MessageSerializer
)
from .services import ChatService


chat_service = ChatService()



BASE_DIR = Path(__file__).resolve().parent.parent.parent
MEDICAL_DOCS_DIR = os.path.join(BASE_DIR, 'medical_documents')

PDF_BOOKS = [
    ("1-DENGUE-WHO-BOOK.pdf", "Dengue Guidelines"),
    ("4-INFLUENZA-WHO-BOOK.pdf", "Influenza Guidelines"),
    ("2-DIARRHOEA-WGO-BOOK.pdf", "DIARRHOEA Guidelines"),
    ("7-Skin-Allergy-Dermatitis-BOOK.pdf", "Skin-Allergy Guidelines"),
    ("8-Typhoid-Fever-WHO-BOOK.pdf", "Typhoid-Fever Guidelines"),
]


print(f"RAG SYSTEM INIT")
print(f"LOADING {len(PDF_BOOKS)} BOOK(S)...")

loaded_count = 0
for filename, book_name in PDF_BOOKS:
    pdf_path = os.path.join(MEDICAL_DOCS_DIR, filename)
    if os.path.exists(pdf_path):
        try:
            result = chat_service.rag_service.load_document(pdf_path, book_name)
            print(f"{book_name}: {result}")
            loaded_count += 1
        except Exception as e:
            print(f"ERROR loading '{book_name}': {e}")
    else:
        print(f"NOT FOUND: {pdf_path}")

print(f"LOADED: {loaded_count}/{len(PDF_BOOKS)} books successfully")

 


def get_user_session_or_404(session_id, firebase_uid):
   
    try:
        session = ChatSession.objects.get(id=session_id)
        if session.firebase_uid != firebase_uid:
            raise Http404("Session not found")
        return session
    except ChatSession.DoesNotExist:
        raise Http404("Session not found")


def get_user_message_or_404(message_id, firebase_uid):
    try:
        message = Message.objects.select_related('session').get(id=message_id)
        if message.session.firebase_uid != firebase_uid:
            raise Http404("Message not found")
        return message
    except Message.DoesNotExist:
        raise Http404("Message not found")




@api_view(['GET'])
def health_check(request):
   
    return Response({
        'status': 'ok',
        'message': 'SEHAT Backend is running'
    })


@api_view(['POST'])
def create_session(request):
   
    firebase_uid = request.data.get('firebase_uid')
    title = request.data.get('title', 'New Chat')
    
    if not firebase_uid:
        return Response(
            {'error': 'firebase_uid is required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    session = chat_service.create_new_session(firebase_uid, title)
    serializer = ChatSessionSerializer(session)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['POST'])  
def get_user_sessions(request):

    firebase_uid = request.data.get('firebase_uid')
    
    if not firebase_uid:
        return Response(
            {'error': 'firebase_uid is required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    sessions = ChatSession.objects.filter(firebase_uid=firebase_uid).order_by('-updated_at')
    serializer = ChatSessionSerializer(sessions, many=True)
    return Response(serializer.data)


@api_view(['POST'])  
def get_session_detail(request):
   
    session_id = request.data.get('session_id')
    firebase_uid = request.data.get('firebase_uid')
    
    if not session_id or not firebase_uid:
        return Response(
            {'error': 'session_id and firebase_uid are required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    session = get_user_session_or_404(session_id, firebase_uid)
    serializer = ChatSessionDetailSerializer(session)
    return Response(serializer.data)


@api_view(['POST'])  
def get_session_messages(request):
  
    session_id = request.data.get('session_id')
    firebase_uid = request.data.get('firebase_uid')
    
    if not session_id or not firebase_uid:
        return Response(
            {'error': 'session_id and firebase_uid are required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    session = get_user_session_or_404(session_id, firebase_uid)
    messages = session.messages.all().order_by('timestamp')
    serializer = MessageSerializer(messages, many=True)
    
    return Response({
        'count': messages.count(),
        'messages': serializer.data
    }, status=status.HTTP_200_OK)


@api_view(['POST'])
def process_query(request):

    session_id = request.data.get('session_id')
    query = request.data.get('query')
    firebase_uid = request.data.get('firebase_uid')
    
    if not session_id or not query or not firebase_uid:
        return Response(
            {'error': 'session_id, query, and firebase_uid are required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    session = get_user_session_or_404(session_id, firebase_uid)
    
    try:
        user_msg, bot_msg = chat_service.process_user_query(str(session.id), query)
        return Response({
            'user_message': MessageSerializer(user_msg).data,
            'bot_message': MessageSerializer(bot_msg).data
        })
    except Exception as e:
        print(f"Error processing query: {e}")
        return Response(
            {'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['DELETE'])
def delete_session(request):
   
    session_id = request.data.get('session_id')
    firebase_uid = request.data.get('firebase_uid')
    
    if not session_id or not firebase_uid:
        return Response(
            {'error': 'session_id and firebase_uid are required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    session = get_user_session_or_404(session_id, firebase_uid)
    session.delete()
    
    return Response(
        {'message': 'Session deleted successfully'},
        status=status.HTTP_200_OK
    )


@api_view(['DELETE'])
def delete_message(request):
   
    message_id = request.data.get('message_id')
    firebase_uid = request.data.get('firebase_uid')
    
    if not message_id or not firebase_uid:
        return Response(
            {'error': 'message_id and firebase_uid are required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    message = get_user_message_or_404(message_id, firebase_uid)
    message.delete()
    
    return Response(
        {'message': 'Message deleted successfully'},
        status=status.HTTP_200_OK
    )


@api_view(['PATCH'])
def update_session_title(request):
   
    session_id = request.data.get('session_id')
    title = request.data.get('title')
    firebase_uid = request.data.get('firebase_uid')
    
    if not session_id or not title or not firebase_uid:
        return Response(
            {'error': 'session_id, title, and firebase_uid are required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    session = get_user_session_or_404(session_id, firebase_uid)
    session.title = title
    session.save()
    
    serializer = ChatSessionSerializer(session)
    return Response(serializer.data)