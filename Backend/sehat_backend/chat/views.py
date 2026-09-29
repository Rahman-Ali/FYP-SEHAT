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
import json
import queue
import re
import threading
from collections import defaultdict
from django.http import StreamingHttpResponse
from rest_framework.decorators import renderer_classes
from rest_framework.renderers import BaseRenderer, JSONRenderer

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
    """Verify the Bearer token (header or body); returns (verified_uid, None) or (None, 401 response)."""
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



# HELPER: Validate User Owns Session
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


# PUBLIC API VIEWS

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


MAX_VOICE_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_VOICE_SECONDS = 60
ALLOWED_VOICE_EXTENSIONS = {'.m4a', '.webm', '.wav'}


@api_view(['POST'])
def voice_transcribe(request):
    """Speech to text for the query box (English + Roman Urdu). Audio is never stored."""
    firebase_uid, error_response = extract_and_verify_token(request)
    if error_response:
        return error_response

    if not check_rate_limit(firebase_uid):
        return Response(
            {'error': 'Too many requests. Please wait a moment.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS
        )

    # Reject oversize bodies before Django parses/spools the upload
    try:
        content_length = int(request.META.get('CONTENT_LENGTH') or 0)
    except ValueError:
        content_length = 0
    if content_length > MAX_VOICE_UPLOAD_BYTES + 64 * 1024:
        return Response(
            {'error': 'Recording is too large. Maximum size is 5 MB.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    audio = request.FILES.get('audio')
    if not audio:
        return Response({'error': 'audio file is required'}, status=status.HTTP_400_BAD_REQUEST)
    if audio.size > MAX_VOICE_UPLOAD_BYTES:
        return Response(
            {'error': 'Recording is too large. Maximum size is 5 MB.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    if audio.size == 0:
        return Response({'error': 'Recording is empty.'}, status=status.HTTP_400_BAD_REQUEST)
    ext = os.path.splitext(audio.name or '')[1].lower()
    if ext not in ALLOWED_VOICE_EXTENSIONS:
        return Response(
            {'error': 'Unsupported audio format. Use m4a, webm or wav.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    from . import voice_service
    import logging
    logger = logging.getLogger(__name__)
    try:
        # Read into memory; Django removes any spooled temp upload file after the request
        text, duration = voice_service.transcribe_audio(f"recording{ext}", audio.read())
    except voice_service.VoiceRateLimited:
        return Response(
            {'error': 'Voice input is busy right now. Please wait a minute and try again.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS
        )
    except Exception as e:
        logger.error("[VOICE] Transcription failed: %s", e)
        return Response(
            {'error': 'Could not transcribe the recording. Please try again or type your question.'},
            status=status.HTTP_502_BAD_GATEWAY
        )
    finally:
        audio.close()

    if duration is not None and duration > MAX_VOICE_SECONDS + 1:
        return Response(
            {'error': 'Recording is too long. Maximum length is 60 seconds.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    return Response({'text': voice_service.to_roman_urdu(text)})


@api_view(['POST'])
def voice_tts(request):
    """MP3 of any bot reply owned by the user; cached in media/tts/<message_id>.mp3."""
    firebase_uid, error_response = extract_and_verify_token(request)
    if error_response:
        return error_response

    message_id = request.data.get('message_id')
    if not message_id:
        return Response({'error': 'message_id is required'}, status=status.HTTP_400_BAD_REQUEST)

    from django.core.exceptions import ValidationError
    try:
        message = Message.objects.select_related('session').get(id=message_id)
    except (Message.DoesNotExist, ValidationError, ValueError):
        return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)
    if message.session.firebase_uid != firebase_uid:
        return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)

    from . import voice_service
    meta = message.metadata if isinstance(message.metadata, dict) else {}
    if message.sender != 'bot':
        return Response(
            {'error': 'Audio is only available for SEHAT replies.'},
            status=status.HTTP_403_FORBIDDEN
        )

    from django.http import FileResponse
    cached = voice_service.tts_cache_path(message.id)
    if cached.exists() and cached.stat().st_size > 0:
        return FileResponse(open(cached, 'rb'), content_type='audio/mpeg')

    import logging
    try:
        language = voice_service.message_language(meta, message.message_text)
        text = voice_service.speakable_text(meta, message.message_text, language)
        path = voice_service.synthesize_to_cache(message.id, text, language)
    except Exception as e:
        logging.getLogger(__name__).error("[VOICE] TTS failed for %s: %s", message.id, e)
        return Response(
            {'error': 'Could not prepare audio right now. Please try again.'},
            status=status.HTTP_502_BAD_GATEWAY
        )
    return FileResponse(open(path, 'rb'), content_type='audio/mpeg')


# STREAMING QUERY (Server-Sent Events)

STREAM_STATUS_TEXT = {
    "understanding": {"english": "Understanding your question...", "roman_urdu": "Aap ka sawal samajh raha hoon..."},
    "searching": {"english": "Searching medical documents...", "roman_urdu": "Medical documents mein talaash kar raha hoon..."},
    "writing": {"english": "Writing answer...", "roman_urdu": "Jawab likh raha hoon..."},
}
STREAM_ERROR_TEXT = {
    "english": "Something went wrong while answering. Please try again.",
    "roman_urdu": "Jawab dete hue masla hua. Baraye meharbani dobara koshish karein.",
}
_ROMAN_URDU_QUERY_HINT = re.compile(
    r"\b(hai|hain|mujhe|mera|meri|mere|aap|ap|se|aur|ka|ki|ke|mein|kya|nahi|bukhar|dard|ulti|khansi|"
    r"pait|sar|din|raat|takleef|dast|zukam|salam|kal|kaise|kia)\b",
    re.IGNORECASE,
)
_STREAM_DONE = object()


def _stream_language(query):
    """Cheap guess used only for the first status line (the pipeline detects the real language)."""
    return "roman_urdu" if _ROMAN_URDU_QUERY_HINT.search(query or "") else "english"


def _sse(event, data):
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


class _EventStreamRenderer(BaseRenderer):
    """Lets clients send Accept: text/event-stream (errors before streaming are rendered as JSON text)."""
    media_type = 'text/event-stream'
    format = 'sse'
    charset = 'utf-8'

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return json.dumps(data).encode('utf-8')


@api_view(['POST'])
@renderer_classes([JSONRenderer, _EventStreamRenderer])
def process_query_stream(request):
    """Same checks and pipeline as process_query, streamed as SSE: status, meta, token..., final | error."""
    firebase_uid, error_response = extract_and_verify_token(request)
    if error_response:
        return error_response

    session_id = request.data.get('session_id')
    query = request.data.get('query')
    chat_history = request.data.get('chat_history', [])

    if not session_id or not query:
        return Response(
            {'error': 'session_id and query are required'},
            status=status.HTTP_400_BAD_REQUEST
        )

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

    if not check_rate_limit(firebase_uid):
        return Response(
            {'error': 'Too many requests. Please wait a moment.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS
        )

    if len(query) > 500:
        return Response(
            {'error': 'Query too long. Maximum 500 characters allowed.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    session = get_user_session_or_404(session_id, firebase_uid)
    guess_lang = _stream_language(query)
    # Same local greeting regex as validate_query: greetings get only meta + final (no status line)
    from .llm_service import LLMService
    q_clean = query.lower().strip().rstrip('!.,;:? ')
    is_greeting = any(re.match(p, q_clean) for p in LLMService.GREETING_PATTERNS)
    events = queue.Queue()
    finished = threading.Event()  # set after final/error: late tokens are dropped

    def emit(event, payload):
        if finished.is_set():
            return
        if event == "status":
            texts = STREAM_STATUS_TEXT.get(payload.get("stage"), {})
            lang = "roman_urdu" if "urdu" in str(payload.get("language") or guess_lang) else "english"
            payload = {"text": texts.get(lang) or texts.get("english", "")}
        events.put((event, payload))

    def worker():
        import logging
        from django.db import connection
        try:
            _, bot_msg = get_chat_service().process_user_query(
                str(session.id), query, chat_history, session=session, on_event=emit
            )
            data = MessageSerializer(bot_msg).data
            meta = data.get('metadata') or {}
            events.put(("final", {
                'message_id': str(bot_msg.id),
                'text': data['message_text'],
                'answer_body': meta.get('answer_body') or data['message_text'],
                'sources': meta.get('sources') or [],
                'disclaimer': meta.get('disclaimer'),
                'triage_level': data.get('triage_level'),
                'response_type': data.get('response_type'),
                'language': meta.get('language'),
                'timestamp': data.get('timestamp'),
            }))
        except Exception as e:
            logging.getLogger(__name__).error("Error processing streamed query: %s", e, exc_info=True)
            events.put(("error", {'message': STREAM_ERROR_TEXT[guess_lang]}))
        finally:
            finished.set()
            events.put(_STREAM_DONE)
            connection.close()  # this thread's DB connection

    def event_stream():
        if not is_greeting:
            yield _sse("status", {"text": STREAM_STATUS_TEXT["understanding"][guess_lang]})
        # Non-daemon: the bot message is still saved if the client disconnects mid-stream
        threading.Thread(target=worker, name="sehat-query-stream").start()
        while True:
            try:
                item = events.get(timeout=15)
            except queue.Empty:
                yield ": keep-alive\n\n"
                continue
            if item is _STREAM_DONE:
                break
            event, payload = item
            yield _sse(event, payload)
            if event in ("final", "error"):
                break

    response = StreamingHttpResponse(event_stream(), content_type='text/event-stream; charset=utf-8')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'
    return response


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


# ADMIN API VIEWS

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