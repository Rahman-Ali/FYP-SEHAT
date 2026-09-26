# backend/chat/views.py
import os
from pathlib import Path
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.db.models import Count
from django.views.decorators.csrf import csrf_exempt
import time
from collections import defaultdict

from .models import ChatSession, Message
from .serializers import (
    ChatSessionSerializer,
    ChatSessionDetailSerializer,
    MessageSerializer
)
from .services import get_chat_service, AuthenticationService
import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)

# Initialize Services
auth_service = AuthenticationService()


def extract_and_verify_token(request):
    """
    Extracts Bearer token from Authorization header or request body,
    verifies it via AuthenticationService, and returns (verified_uid, error_response).
    If verification fails, returns (None, Response(..., status=401)).
    """
    auth_header = request.headers.get('Authorization') or request.META.get('HTTP_AUTHORIZATION')
    token = None
    if auth_header and auth_header.strip().lower().startswith('bearer '):
        token = auth_header.strip()[7:].strip()
    elif isinstance(request.data, dict):
        token = request.data.get('id_token') or request.data.get('token')

    if not token:
        return None, Response(
            {'error': 'Authentication required: missing authentication token'},
            status=status.HTTP_401_UNAUTHORIZED
        )

    verified_uid = auth_service.verify_firebase_token(token)
    if not verified_uid:
        return None, Response(
            {'error': 'Authentication failed: invalid or expired Firebase token'},
            status=status.HTTP_401_UNAUTHORIZED
        )

    return verified_uid, None

# ==========================================================
# REST OF THE FILE REMAINS EXACTLY THE SAME
# ==========================================================
# ... (all existing code from HELPER functions to ADMIN VIEWS) ...


# ==========================================================
# HELPER: Validate User Owns Session
# ==========================================================
def get_user_session_or_404(session_id, firebase_uid, with_message_count=False):
    try:
        qs = ChatSession.objects
        if with_message_count:
            # Same lookup + message count in one query (no extra COUNT round trip)
            qs = qs.annotate(message_count_value=Count('messages'))
        session = qs.get(id=session_id)
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
    firebase_uid, error_response = extract_and_verify_token(request)
    if error_response:
        return error_response

    title = request.data.get('title', 'New Chat')
    session = get_chat_service().create_new_session(firebase_uid, title)
    session.message_count_value = 0  # brand-new session: skip the COUNT query
    serializer = ChatSessionSerializer(session)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
def get_user_sessions(request):
    firebase_uid, error_response = extract_and_verify_token(request)
    if error_response:
        return error_response

    # Count messages in the same query (was one COUNT query per session)
    sessions = (ChatSession.objects.filter(firebase_uid=firebase_uid)
                .annotate(message_count_value=Count('messages'))
                .order_by('-updated_at'))
    serializer = ChatSessionSerializer(sessions, many=True)
    return Response(serializer.data)


@api_view(['POST'])
def get_session_detail(request):
    firebase_uid, error_response = extract_and_verify_token(request)
    if error_response:
        return error_response

    session_id = request.data.get('session_id')
    if not session_id:
        return Response(
            {'error': 'session_id is required'},
            status=status.HTTP_400_BAD_REQUEST
        )

    session = get_user_session_or_404(session_id, firebase_uid)
    serializer = ChatSessionDetailSerializer(session)
    return Response(serializer.data)


@api_view(['POST'])
def get_session_messages(request):
    firebase_uid, error_response = extract_and_verify_token(request)
    if error_response:
        return error_response

    session_id = request.data.get('session_id')
    if not session_id:
        return Response(
            {'error': 'session_id is required'},
            status=status.HTTP_400_BAD_REQUEST
        )

    session = get_user_session_or_404(session_id, firebase_uid)
    messages = session.messages.all().order_by('timestamp')
    serializer = MessageSerializer(messages, many=True)
    data = serializer.data  # evaluate once; count from the fetched rows (no extra COUNT query)

    return Response({
        'count': len(data),
        'messages': data
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
    firebase_uid, error_response = extract_and_verify_token(request)
    if error_response:
        return error_response

    session_id = request.data.get('session_id')
    query = request.data.get('query')
    chat_history = request.data.get('chat_history', [])  # [MEMORY] Extract history

    if not session_id or not query:
        return Response(
            {'error': 'session_id and query are required'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Check warm-up state before processing
    from .warmup import get_warmup_state, start_warmup
    warmup_state = get_warmup_state()
    if warmup_state == "idle":
        start_warmup()
        warmup_state = get_warmup_state()

    if warmup_state in ("idle", "loading"):
        resp = Response(
            {'error': 'warming_up'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )
        resp['Retry-After'] = '15'
        return resp
    elif warmup_state == "failed":
        return Response(
            {'error': 'knowledge_base_unavailable'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )

    # [SECURITY] Rate limit check with verified UID
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
        user_msg, bot_msg = get_chat_service().process_user_query(
            str(session.id), query, chat_history, session=session
        )
        return Response({
            'user_message': MessageSerializer(user_msg).data,
            'bot_message': MessageSerializer(bot_msg).data
        })
    except Exception as e:
        import logging
        logging.getLogger(__name__).error("Error processing query: %s", e, exc_info=True)
        return Response(
            {
                'error': 'internal_server_error',
                'message': 'Failed to process query. Please try again.',
                'details': str(e),
                'bot_message': {
                    'message_text': 'A connection or server error occurred. Please try again.',
                    'metadata': {
                        'source': 'Error',
                        'triage_level': None
                    }
                }
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['DELETE'])
def delete_session(request):
    firebase_uid, error_response = extract_and_verify_token(request)
    if error_response:
        return error_response

    session_id = request.data.get('session_id')
    if not session_id:
        return Response(
            {'error': 'session_id is required'},
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
    firebase_uid, error_response = extract_and_verify_token(request)
    if error_response:
        return error_response

    message_id = request.data.get('message_id')
    if not message_id:
        return Response(
            {'error': 'message_id is required'},
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
    firebase_uid, error_response = extract_and_verify_token(request)
    if error_response:
        return error_response

    session_id = request.data.get('session_id')
    title = request.data.get('title')

    if not session_id or not title:
        return Response(
            {'error': 'session_id and title are required'},
            status=status.HTTP_400_BAD_REQUEST
        )

    session = get_user_session_or_404(session_id, firebase_uid, with_message_count=True)
    session.title = title
    session.save(update_fields=['title', 'updated_at'])

    serializer = ChatSessionSerializer(session)
    return Response(serializer.data)


# ==========================================================
# ADMIN API VIEWS
# ==========================================================

@api_view(['GET'])
def admin_list_documents(request):
    """List all documents in the knowledge base."""
    try:
        documents = get_chat_service().get_documents()
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
        result = get_chat_service().add_document(uploaded_file, filename)
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
        result = get_chat_service().remove_document(filename)
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