# backend/chat/voice_service.py
"""Voice input (Groq Whisper speech-to-text) and voice playback (edge-tts) helpers."""
import asyncio
import logging
import os
import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

WHISPER_MODEL = "whisper-large-v3-turbo"
# Short Roman Urdu + English sample so Whisper writes Urdu speech in Latin letters
ROMAN_URDU_PROMPT = (
    "Mujhe kal se bukhar hai aur sar mein dard ho raha hai. "
    "Khansi bhi hai. I have fever and headache."
)

URDU_VOICE = "ur-PK-UzmaNeural"
ENGLISH_VOICE = "en-US-JennyNeural"
TTS_CACHE_DIR = Path(settings.BASE_DIR) / "media" / "tts"

# Arabic/Urdu script blocks, plus Devanagari (Whisper sometimes writes Urdu speech in Hindi script)
_NON_LATIN_SCRIPT_RE = re.compile(
    r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿ऀ-ॿ]"
)
_ARABIC_SCRIPT_RE = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")
_ROMAN_URDU_HINT_RE = re.compile(
    r"\b(hai|hain|aap|apni|nahi|karein|mein|kisi|baraye|meharbani|jald|takleef|bukhar)\b",
    re.IGNORECASE,
)

DEFAULT_DISCLAIMER = {
    "english": "This is not a substitute for professional medical advice.",
    "roman_urdu": "Ye kisi professional doctor ki salah ka mutbadil nahi hai.",
}


class VoiceRateLimited(Exception):
    """Groq returned 429 for the transcription request."""


def _groq_api_key() -> str:
    return (os.getenv("GROQ_API_KEY") or "").strip().strip('"').strip("'")


def _aux_llm_call(prompt: str) -> str:
    from .services import get_chat_service
    return get_chat_service().llm_service._call_aux_llm(prompt)


# Speech to text

def transcribe_audio(filename: str, audio_bytes: bytes) -> tuple[str, float | None]:
    """Transcribe audio with Groq Whisper; returns (text, duration_seconds or None)."""
    from groq import Groq, RateLimitError

    key = _groq_api_key()
    if not key:
        raise RuntimeError("GROQ_API_KEY not configured")

    client = Groq(api_key=key, timeout=45, max_retries=0)
    try:
        resp = client.audio.transcriptions.create(
            file=(filename, audio_bytes),
            model=WHISPER_MODEL,
            prompt=ROMAN_URDU_PROMPT,
            response_format="verbose_json",
            temperature=0.0,
        )
    except RateLimitError as e:
        raise VoiceRateLimited(str(e)) from e

    text = (getattr(resp, "text", "") or "").strip()
    duration = getattr(resp, "duration", None)
    if duration is None:
        duration = (getattr(resp, "model_extra", None) or {}).get("duration")
    try:
        duration = float(duration) if duration is not None else None
    except (TypeError, ValueError):
        duration = None
    return text, duration


def to_roman_urdu(text: str) -> str:
    """Rewrite any Urdu/Hindi-script words in Roman Urdu (one aux LLM call); English is kept as is."""
    if not text or not _NON_LATIN_SCRIPT_RE.search(text):
        return text
    prompt = (
        "Convert this speech transcript to Roman Urdu (Urdu written only with English letters a-z).\n"
        "Rules:\n"
        "- Transliterate every word written in Urdu/Arabic or Hindi/Devanagari script into Roman Urdu.\n"
        "- Keep English words and sentences exactly as they are.\n"
        "- Do not translate, answer, explain, add or remove anything.\n"
        "- Output ONLY the converted transcript.\n\n"
        f"Transcript:\n{text}\n\nRoman Urdu:"
    )
    try:
        converted = _aux_llm_call(prompt).strip().strip('"').strip()
    except Exception as e:
        logger.warning("[VOICE] Roman Urdu conversion failed, returning raw transcript: %s", e)
        return text
    return converted or text


# Text to speech

def effective_response_type(meta: dict) -> str:
    """response_type from metadata; older messages without it count as final when they have sources."""
    meta = meta if isinstance(meta, dict) else {}
    rtype = meta.get("response_type")
    if rtype:
        return rtype
    if isinstance(meta.get("sources"), list) and meta.get("sources"):
        return "final"
    return "other"


def message_language(meta: dict, text: str) -> str:
    lang = str((meta or {}).get("language") or "").lower()
    if "urdu" in lang:
        return "roman_urdu"
    if lang == "english":
        return "english"
    # Older emergency replies have no language field
    if _ARABIC_SCRIPT_RE.search(text or "") or len(_ROMAN_URDU_HINT_RE.findall(text or "")) >= 2:
        return "roman_urdu"
    return "english"


def speakable_text(meta: dict, message_text: str, language: str) -> str:
    """answer_body without sources, page numbers or markdown symbols, plus the short disclaimer."""
    meta = meta if isinstance(meta, dict) else {}
    text = meta.get("answer_body") or message_text or ""
    text = text.split("--- Sources ---")[0]
    text = re.split(r"(?im)^\s*(?:sources?|references?)\s*:?\s*$", text)[0]      # trailing sources section
    text = re.sub(r"\[(?:\d+(?:\s*[,-]\s*\d+)*)\]", "", text)                    # [1], [1, 2]
    text = re.sub(r"\(\s*(?:p|pp|page|pages)\.?\s*[\d,\s-]+\)", "", text, flags=re.IGNORECASE)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"(?m)^\s*#{1,6}\s*", "", text)                                 # headers
    text = re.sub(r"(?m)^\s*(?:[-*•>]|\d+[.)-])\s+", "", text)                     # bullets / numbering
    text = re.sub(r"[*_`#~|>]", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" +([.,;:!?])", r"\1", text)
    text = re.sub(r"\n{2,}", "\n", text).strip()

    disclaimer = meta.get("disclaimer")
    if not disclaimer and effective_response_type(meta) in ("final", "emergency"):
        disclaimer = DEFAULT_DISCLAIMER.get(language, DEFAULT_DISCLAIMER["english"])
    if disclaimer and disclaimer.lower() not in text.lower():
        text = f"{text}\n{disclaimer}"
    return text


def roman_urdu_to_urdu_script(text: str) -> str:
    """Convert Roman Urdu to Urdu script for the Urdu voice (one aux LLM call)."""
    prompt = (
        "Convert the following Roman Urdu text into proper Urdu script (Arabic letters) so an Urdu "
        "text-to-speech voice can read it aloud.\n"
        "Rules:\n"
        "- Write medical/English terms (e.g. dengue, paracetamol, ORS) phonetically in Urdu script.\n"
        "- Keep numbers as digits.\n"
        "- Do not add, remove, summarize or explain anything.\n"
        "- Output ONLY the Urdu text.\n\n"
        f"Text:\n{text}\n\nUrdu:"
    )
    urdu = _aux_llm_call(prompt).strip()
    if not _ARABIC_SCRIPT_RE.search(urdu):
        raise ValueError("Urdu script conversion returned no Urdu text")
    return urdu


async def _edge_tts_save(text: str, voice: str, path: str):
    import edge_tts
    await edge_tts.Communicate(text, voice).save(path)


def tts_cache_path(message_id) -> Path:
    return TTS_CACHE_DIR / f"{message_id}.mp3"


def synthesize_to_cache(message_id, text: str, language: str) -> Path:
    """Render MP3 for a message into media/tts/<message_id>.mp3 (atomic write) and return its path."""
    final_path = tts_cache_path(message_id)
    if language == "roman_urdu":
        speak, voice = roman_urdu_to_urdu_script(text), URDU_VOICE
    else:
        speak, voice = text, ENGLISH_VOICE

    TTS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = TTS_CACHE_DIR / f"{message_id}.{uuid.uuid4().hex}.tmp"
    try:
        # Own thread + event loop so this works whether or not the caller has a running loop
        with ThreadPoolExecutor(max_workers=1) as ex:
            ex.submit(asyncio.run, _edge_tts_save(speak, voice, str(tmp_path))).result(timeout=90)
        if not tmp_path.exists() or tmp_path.stat().st_size == 0:
            raise RuntimeError("edge-tts produced no audio")
        os.replace(tmp_path, final_path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
    return final_path
