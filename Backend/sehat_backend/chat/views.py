# backend/chat/views.py
import os
from pathlib import Path
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
import time
from collections import defaultdict

from .models import ChatSession, Message
from .serializers import (
    ChatSessionSerializer,
    ChatSessionDetailSerializer,
    MessageSerializer
)
from .services import ChatService
import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)

# Initialize Service
chat_service = ChatService()

# -------------------------------------------------------
# DYNAMIC PDF LOADING - No hardcoded file names
# -------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent.parent
MEDICAL_DOCS_DIR = os.path.join(BASE_DIR, 'medical_documents')

print(f"RAG SYSTEM INIT")
print(f"MEDICAL DOCS DIR: {MEDICAL_DOCS_DIR}")

# Ensure the directory exists
os.makedirs(MEDICAL_DOCS_DIR, exist_ok=True)

# Get all PDF files from the directory
pdf_files = [f for f in os.listdir(MEDICAL_DOCS_DIR) if f.endswith('.pdf')]

if not pdf_files:
    print("WARNING: No PDF files found in medical_documents directory")
else:
    print(f"LOADING {len(pdf_files)} BOOK(S)...")
    
    loaded_count = 0
    for filename in pdf_files:
        pdf_path = os.path.join(MEDICAL_DOCS_DIR, filename)
        # Use filename (without .pdf) as the display name
        book_name = filename.replace('.pdf', '').replace('-', ' ').replace('_', ' ')
        
        try:
            result = chat_service.rag_service.load_document(pdf_path, book_name)
            print(f"  {book_name}: {result}")
            loaded_count += 1
        except Exception as e:
            print(f"  ERROR loading '{filename}': {e}")
    
    print(f"LOADED: {loaded_count}/{len(pdf_files)} books successfully")

print(f"----------------------------------------")

# ==========================================================
# REST OF THE FILE REMAINS EXACTLY THE SAME
# ==========================================================
# ... (all existing code from HELPER functions to ADMIN VIEWS) ...


# ==========================================================
# HELPER: Validate User Owns Session
# ==========================================================
def get_user_session_or_404(session_id, firebase_uid):
    try:
        session = ChatSession.objects.get(id=session_id)
        if session.firebase_uid != firebase_uid:
            from django.http import Http404
            raise Http404("Session not found")
        return session
    except ChatSession.DoesNotExist:
        from django.http import Http404
        raise Http404("Session not found")


# ==========================================================
# PUBLIC API VIEWS
# ==========================================================

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




# Simple in-memory rate limiter (use Redis in production)
rate_limit_cache = defaultdict(list)

def check_rate_limit(firebase_uid, max_requests=10, window_seconds=60):
    """Allow max_requests per window_seconds."""
    now = time.time()
    user_requests = rate_limit_cache[firebase_uid]
    
    # Remove old requests
    user_requests = [t for t in user_requests if now - t < window_seconds]
    rate_limit_cache[firebase_uid] = user_requests
    
    if len(user_requests) >= max_requests:
        return False
    
    user_requests.append(now)
    return True

@api_view(['POST'])
def process_query(request):
    session_id = request.data.get('session_id')
    query = request.data.get('query')
    firebase_uid = request.data.get('firebase_uid')
    chat_history = request.data.get('chat_history', [])  # [MEMORY] Extract history
    
    if not session_id or not query or not firebase_uid:
        return Response(
            {'error': 'session_id, query, and firebase_uid are required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # [SECURITY] Rate limit check
    if not check_rate_limit(firebase_uid):
        return Response(
            {'error': 'Too many requests. Please wait a moment.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS
        )
    
    # [SECURITY] Length check
    if len(query) > 500:
        return Response(
            {'error': 'Query too long. Maximum 500 characters allowed.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    session = get_user_session_or_404(session_id, firebase_uid)
    
    try:
        # [MEMORY] Pass chat_history to service
        user_msg, bot_msg = chat_service.process_user_query(
            str(session.id), query, chat_history
        )
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
    
    try:
        message = Message.objects.get(id=message_id)
        if message.session.firebase_uid != firebase_uid:
            from django.http import Http404
            raise Http404("Message not found")
        message.delete()
    except Message.DoesNotExist:
        from django.http import Http404
        raise Http404("Message not found")
    
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


# ==========================================================
# ADMIN API VIEWS
# ==========================================================

@api_view(['GET'])
def admin_list_documents(request):
    """List all documents in the knowledge base."""
    try:
        documents = chat_service.get_documents()
        return Response({
            'success': True,
            'documents': documents,
            'count': len(documents)
        })
    except Exception as e:
        return Response(
            {'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )



@csrf_exempt
@api_view(['POST'])
def admin_add_document(request):
    """Add a new medical PDF document."""
    
  
    print("[ADMIN ADD] Request received")
    print("[ADMIN ADD] FILES:", request.FILES)
    print("[ADMIN ADD] KEYS:", request.FILES.keys())
    print("[ADMIN ADD] Content-Type:", request.content_type)
    
    uploaded_file = request.FILES.get('document')
    
    if not uploaded_file:
        print("[ADMIN ADD] No 'document' in FILES")
        return Response(
            {'error': 'No document file provided. Available keys: ' + str(list(request.FILES.keys()))},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    filename = uploaded_file.name
    print(f"[ADMIN ADD] File: {filename}, Size: {uploaded_file.size}")
    
    if not filename.endswith('.pdf'):
        return Response(
            {'error': 'Only PDF files are allowed'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    try:
        result = chat_service.add_document(uploaded_file, filename)
        print(f"[ADMIN ADD] Result: {result}")
        
        if result.get('success'):
            return Response(result, status=status.HTTP_201_CREATED)
        else:
            return Response(
                {'error': result.get('error', 'Unknown error')},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    except Exception as e:
        print(f"[ADMIN ADD] Exception: {e}")
        import traceback
        traceback.print_exc()
        return Response(
            {'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

@csrf_exempt
@api_view(['DELETE'])
def admin_remove_document(request):
    """Remove a document from the knowledge base."""
    filename = request.data.get('filename')
    print(f"[ADMIN DELETE] Request to delete: {filename}")
    
    if not filename:
        return Response(
            {'error': 'filename is required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    try:
        result = chat_service.remove_document(filename)
        print(f"[ADMIN DELETE] Result: {result}")
        
        if result.get('success'):
            return Response(result)
        else:
            return Response(
                {'error': result.get('error', 'Unknown error')},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    except Exception as e:
        print(f"[ADMIN DELETE] Exception: {e}")
        return Response(
            {'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )