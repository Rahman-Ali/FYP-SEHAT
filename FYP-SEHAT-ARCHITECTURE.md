# SEHAT — Architecture & Request Flow

This document explains **exactly what happens in the code**, step by step, with real file and function names. Setup instructions are in [README.md](README.md).

All backend paths are relative to `Backend/sehat_backend/`.

---

## 1. Big picture

```mermaid
flowchart TD
    subgraph App["Mobile app (Frontend/app)"]
        UI["screens/(tabs)/chatbot.jsx"]
        LIB["screens/(tabs)/library.jsx\n+ ReferenceBookViewer (pdf.js WebView)"]
        API["services/api.jsx (Axios / expo fetch + Firebase token)"]
    end
    subgraph Django["Django backend"]
        MW["sehat_backend/health_middleware.py\n/healthz, /readyz"]
        V["chat/views.py\nprocess_query() / process_query_stream()"]
        LS["chat/library_service.py\nbooks + signed links"]
        VO["chat/voice_service.py\nSTT + TTS"]
        CS["chat/services.py\nChatService.process_user_query()"]
        R1["chat/rag_service.py\nretrieve_context()"]
        R2["chat/rag_service.py\ngenerate_with_context()"]
        L["chat/llm_service.py\nLLMService"]
        VS["chat/vector_store_service.py\nhybrid_search()"]
        W["chat/warmup.py\n(background start-up)"]
    end
    subgraph Cloud["Cloud services"]
        PG[("Neon PostgreSQL\nchat_sessions, messages")]
        N4J[("Neo4j Aura\nMedicalDocument + vector index medical_docs")]
        GROQ["Groq  openai/gpt-oss-20b"]
        GEM["Google Gemini  gemini-3.1-flash-lite"]
        FB["Firebase Auth"]
        EDGE["edge-tts"]
    end

    UI --> API --> MW --> V --> CS
    V -. verify token .-> FB
    CS <--> PG
    CS --> R1 --> L
    R1 --> VS --> N4J
    CS --> R2 --> L
    L --> GROQ
    L --> GEM
    W -. loads models + BM25 .-> VS
    LIB --> API
    V --> LS --> N4J
    V --> VO --> GROQ
    VO --> EDGE
```

---

## 2. Server start-up (`chat/apps.py` → `chat/warmup.py`)

1. `ChatConfig.ready()` initialises Firebase Admin and calls `start_warmup()` (skipped for `migrate`, `test`, `shell`, … and in the runserver auto-reloader parent).
2. `_run_warmup()` runs in a background thread:
   - resolves the Neo4j database name,
   - loads `all-MiniLM-L6-v2` (`VectorStoreService.load_models`) — ~36 s,
   - rebuilds the in-memory BM25 index from all Neo4j chunks (`warm_up_bm25_from_neo4j`) — ~12 s,
   - attaches the Neo4j vector index `medical_docs`.
3. State goes `idle → loading → ready` (or `failed`). Until `ready`, `/readyz` and `/api/chat/query/` return **503** (`warming_up`, header `Retry-After: 15`); the app shows "SEHAT AI is warming up. Please retry in a few seconds."

---

## 3. One chat message, step by step

### Step 1 — App (`Frontend/app/screens/(tabs)/chatbot.jsx`, `services/api.jsx`)
- User types (or speaks, see §7) a message; `apiService.streamMessage()` posts to `POST /api/chat/query/stream/` with `session_id`, `query`, `firebase_uid`, `chat_history` using `expo/fetch` (readable stream). If the stream fails before any event arrives (or streaming is unsupported), the app falls back to `apiService.sendMessage()` → `POST /api/chat/query/`. The user can **stop** a reply mid-stream (`AbortController`).
- An Axios interceptor (and the streaming call) attaches `Authorization: Bearer <Firebase ID token>`.
- Base URL comes from `getBaseUrl()` in `api.jsx`: in development the LAN IP Expo serves from, else `EXPO_PUBLIC_API_URL`, else `10.0.2.2` / `localhost`.

### Step 2 — View (`chat/views.py` → `process_query` / `process_query_stream`)
1. `extract_and_verify_token()` verifies the Firebase ID token (Firebase Admin, `AuthenticationService.verify_firebase_token` in `chat/services.py`) → **401** if missing/invalid.
2. `session_id` and `query` required → **400** otherwise.
3. Warm-up gate → **503** until the knowledge base is ready.
4. `check_rate_limit()` — max 10 requests / 60 s per user → **429**.
5. Query length ≤ 500 chars.
6. `get_user_session_or_404()` — the session must belong to this user.
7. Calls `ChatService.process_user_query()`.

**Streaming variant (`process_query_stream`)** — same checks, then `ChatService.process_user_query(..., on_event=emit)` runs in a worker thread and pushes events into a queue that a `StreamingHttpResponse` drains as Server-Sent Events:

| Event | Payload | When |
|---|---|---|
| `status` | `{text}` — "Understanding your question…", "Searching medical documents…", "Writing answer…" (English or Roman Urdu) | Each pipeline stage |
| `token` | `{text}` — next piece of the answer | While Gemini generates (`on_token` in `generate_with_context`) |
| `final` | Saved bot message: `message_id`, `text`, `answer_body`, triage, sources, disclaimer | Once, after all post-generation checks |
| `error` | `{message}` in the user's language | On failure |

A `: keep-alive` comment is sent every 15 s. The worker thread is non-daemon, so the bot message is still saved if the client disconnects. Tokens after `final`/`error` are dropped, and the app replaces the streamed text with `final.answer_body` (post-generation checks such as the language-purity rewrite can change it).

### Step 3 — Chat service (`chat/services.py` → `ChatService.process_user_query`)
1. Loads the session's messages **from the database** (the backend is the source of truth; client `chat_history` is ignored) and groups them into turns (`extract_turn_pairs`).
2. `trigger_rolling_summarization_if_needed()` — when more than 8 turns exist, older turns are summarised once into `session.rolling_summary`.
3. Saves the user `Message`.
4. Calls `RAGService.retrieve_context()` with the last 8 turns, `clarification_round`, `rolling_summary`, `patient_context`.
5. **Subject tracking**: if the classifier reports a new patient (`subject_reference`, e.g. "my uncle"), `patient_context` is reset. On an **emergency** turn only `active_subject` is updated (facts are kept).
6. Merges new patient facts into `session.patient_context` (`merge_patient_facts`).
7. Calls `RAGService.generate_with_context()`.
8. Updates `clarification_round` (incremented on a follow-up question, reset on an answer / emergency).
9. Saves the bot `Message` (text + metadata: triage, sources, language, timings) in a single INSERT and logs one `[TIMING SUMMARY]` line.

### Step 4 — Understanding the message (`chat/rag_service.py` → `retrieve_context`)
1. `sanitize_input()` blocks prompt-injection patterns.
2. **In parallel** (thread pool `_EXECUTOR`):
   - `validate_query()` — regex greeting check; short queries (≤ 7 words) pass as valid; longer ones get an LLM check (VALID / UNCLEAR / INVALID / GREETING).
   - `detect_language()` — `english` / `roman_urdu` (Devanagari → `invalid_hindi`).
   - `classify_and_rewrite_query()` — the **intake classifier** (skipped for plain greetings).
3. **Emergency first**: if the classifier returns `triage_level == "Emergency"`, it overrides an "unclear/invalid" validation result (except prompt-injection inputs) and the turn returns immediately with status `emergency` — no search, no generation.
4. Greeting / invalid / unclear / Hindi → early return with that status.
5. Otherwise the classifier's `intent` routes the turn:

| `intent` | Result status | What happens next |
|---|---|---|
| `meta_query` ("what did I tell you?") | `meta_history` | Answer from conversation history |
| `translation_request` | `translation_request` | Re-render last bot reply in the requested language |
| `new_symptom_info` / `followup_answer` with missing details (and < 5 rounds) | `clarifying` | Ask **one** follow-up question |
| `capabilities_query` | `capabilities` | Explain what SEHAT can do |
| `small_talk` | `small_talk` | Short friendly reply, invite a health question |
| `off_topic` | `off_topic` | "I can only help with health questions." |
| `sufficient_for_answer` (or 5 rounds reached) | `valid` | Search + answer (below) |

6. For `valid`: the English search query comes from the classifier's `english_query` (fallback: `translate_to_english`), then `VectorStoreService.hybrid_search()`.

#### The intake classifier (`llm_service.py` → `classify_and_rewrite_query`)
One JSON call that returns: `intent`, `rewritten_query` (pronouns resolved from history), `english_query`, `new_facts`, `missing_for_diagnosis`, `follow_up_question`, `target_language`, `subject_reference`, **`triage_level`** and **`emergency_advice`**.
- Triage is judged from meaning (any spelling / language), using current message + history. No keyword lists.
- On a classifier failure, `classify_triage()` is called once as backup; if that also fails the level is `Doctor` (never `Self-Care` by default).

### Step 5 — Hybrid search (`chat/vector_store_service.py` → `hybrid_search`)
1. **Neo4j vector search** (top 10) runs in a background thread **while** **BM25** (top 10) runs locally.
2. **Reciprocal Rank Fusion**: `score = 0.4/(rank_bm25+60) + 0.6/(rank_neo4j+60)`.
3. **SBERT rerank**: all candidates encoded in one batch; cosine similarity to the query.
4. If the best score is **< 0.48** → no results ("no relevant content"). Otherwise keep chunks ≥ 0.35, max 5.

### Step 6 — Writing the answer (`chat/rag_service.py` → `generate_with_context`)
Branches by status: clarifying, meta_history, translation, off_topic, small_talk, **emergency**, greeting, capabilities, invalid, unclear, Hindi, then the main pipeline:

1. No chunks → triage-aware fallback: `Self-Care` → "not found in documents"; otherwise → "Please see a doctor soon."
2. **In parallel**: `verify_relevance()` (does the text answer the question?) and `generate_answer()` (Gemini). If relevance says NO, the generated answer is discarded and the fallback above is used.
3. `generate_answer()` prompt rules: answer only from the retrieved text, strict language (English or Roman Urdu), 4–6 points, highlight red flags, **no follow-up questions in the final answer**, always end with the disclaimer. Roman Urdu answers get a purity check (Arabic script / English leakage → one re-write).
4. RAGAS metrics run in a background thread (0.5 s wait); faithfulness < 0.25 would replace the answer with the no-info message.
5. Citations are built by `_build_citations()` (curated display title + page numbers) and appended as `--- Sources ---`. Neo4j stores 0-based page indexes; citations show **1-based** page numbers (what users and the PDF viewer count). Each structured source carries `sequence`, `title`, `clean_title`, `filename`, `doc_id` (opaque Library id), `disease` and `pages` (integers).
6. `triage_level` comes from the intake classifier (`classify_triage` only if missing).

**Emergency reply** = "call **1122**" header in the user's language + the classifier's situation-specific `emergency_advice` (generic first-aid text if empty).

---

## 4. LLM providers (`chat/llm_service.py`)

| Call type | Chain | Notes |
|---|---|---|
| Aux calls (`_call_aux_llm`): classifier, validate, language, relevance, triage backup, greeting, translation | **Groq** `openai/gpt-oss-20b` → **Gemini** `gemini-3.1-flash-lite` → **OpenAI** `gpt-4o` | Order set by `AUX_LLM_PROVIDER_ORDER` (`groq_first` default) |
| Answer generation (`_call_generation_llm`) | **Gemini** → Groq | |

Safety / speed behaviour:
- Groq `max_retries=0`; on a **429** Groq is skipped until its `retry-after` passes (circuit breaker `_groq_blocked_until`).
- A Groq reply cut off at `max_tokens` (`finish_reason == "length"`, gpt-oss spends tokens on reasoning) is treated as a failure → next provider.
- OpenAI `insufficient_quota` → OpenAI skipped for 1 hour (`_openai_blocked_until`).
- Clients are created once and reused (`_aux_clients`).

Free-tier limits (current keys): Groq 8,000 tokens/min and 200,000 tokens/day; Gemini requests/min limit; OpenAI key has no credits.

---

## 5. Triage

| Level | Meaning (used in both classifier and `classify_triage`) | App badge (`chatbot.jsx`) |
|---|---|---|
| `Emergency` | Possible threat to life, limb or safety of anyone, incl. self-harm | Red "Emergency" |
| `Doctor` | Needs in-person exam, tests or prescription | Orange "Consult Doctor" |
| `Self-Care` | Mild, safe to manage at home | Green "Self-Care" |
| `null` | No clinical content (greeting, small talk, off-topic, meta, translation) | No badge |

If unsure, the more urgent level is chosen.

---

## 6. Reference-book Library (`chat/library_service.py`, `Frontend/app/screens/(tabs)/library.jsx`)

The Library tab shows the curated offline disease guides (`books.jsx`, bundled PDFs in `Frontend/assets/books/`) **plus** every indexed guideline book on the server.

1. **List** — `GET library/documents/` (Firebase token). `get_library()` joins Neo4j `MedicalDocument` nodes (`source_file`, `disease`, `display_title`, `max(page)`) with the PDFs actually present in `Backend/medical_documents/`, groups them by disease (`general` last) and caches the result for 5 minutes. Each book: `doc_id`, `title`, `disease`, `pages` (from pypdf), `size_mb`, `downloadable`. File names and paths are never sent.
2. **doc_id** — first 20 hex chars of `sha256("sehat-library:<source_file>")`: stable, opaque, and the same value the chat citations carry.
3. **Link** — `GET library/documents/<doc_id>/link/?purpose=read|download` returns a **10-minute signed token** (`TimestampSigner`, salt `sehat.library.file`) as a relative `file_path`, and for `read` a `viewer_path` to the vendored pdf.js viewer (`/static/pdfjs/web/viewer.html?file=…`). Relative paths keep the viewer and PDF same-origin (a pdf.js requirement), also behind ngrok.
4. **File** — `GET library/file/<signed>/` checks the signature and expiry, re-resolves the id to a file directly inside `medical_documents/` (no path traversal), and streams the PDF (`as_attachment` for downloads).
5. **Download policy** — `LIBRARY_DOWNLOADABLE_JSON` (`.env`) lists books that may only be read in-app; download requests for them get **403 `not_downloadable`**.
6. **Cache invalidation** — `admin_add_document` / `admin_remove_document` call `library_service.clear_cache()`, so added books appear and removed ones disappear on the next request. A removed book returns **404 `not_available`** ("This source is no longer available").

App side: `components/library/ReferenceBookViewer.jsx` opens the viewer URL in a WebView at `#page=N`; `apiService.downloadLibraryBook()` saves the PDF into the app's documents folder with progress and shares it via `expo-sharing`. The last list is cached in AsyncStorage, so the tab still shows books offline (reading and downloading need the server).

**Citation → page**: in `chatbot.jsx` each source title opens the Library at that book, and each `p. N` chip opens the reader directly at page N (`router.push` to `/screens/library` with `doc`, `page`, `open`, `citeNonce`). Older messages without `doc_id` are matched by title.

The pdf.js viewer is vendored as a legacy build with printing, downloading, scripting and external links disabled; local changes are listed in `chat/static/pdfjs/VENDORED.md`. Run `collectstatic` after changing it.

---

## 7. Voice (`chat/voice_service.py`)

- **Voice input** — the app records up to 60 s (`expo-audio`) and posts it to `voice/transcribe/` (m4a / webm / wav, ≤ 5 MB, rate-limited like queries). Groq **Whisper `whisper-large-v3-turbo`** transcribes it; Urdu-script output is converted to Roman Urdu. The text fills the input box for the user to review. Audio is never stored.
- **Voice playback** — `voice/tts/` with a `message_id` returns an MP3 of one of the user's own bot replies. **edge-tts** speaks English with `en-US-JennyNeural` and Roman Urdu (converted to Urdu script) with `ur-PK-UzmaNeural`. Files are cached in `media/tts/<message_id>.mp3`.
- Each bot bubble also has a **copy** button (answer + disclaimer).

---

## 8. Data model (`chat/models.py`)

- **`ChatSession`** (`chat_sessions`): `id` (UUID), `firebase_uid`, `title`, `session_metadata` (JSON: `clarification_round`, `active_subject`), `rolling_summary`, `patient_context` (JSON facts), `summarized_up_to_turn`, timestamps.
- **`Message`** (`messages`): `id`, `session`, `sender` (`user`/`bot`), `message_text`, `metadata` (JSON: `triage_level`, `sources`, `answer_body`, `disclaimer`, `language`, `model`, `ragas_metrics`, `stage_timings`), `timestamp`, `sequence_number`.

Database: Neon PostgreSQL with `conn_max_age=600` and `conn_health_checks=True` (Neon drops idle connections).

---

## 9. Knowledge base

- **15 PDFs** in `Backend/medical_documents/` covering 10 diseases: Dengue, Diarrhoea, Hepatitis A, Influenza, Tuberculosis, Malaria, Skin allergy / contact dermatitis, Typhoid, Common cold, UTI.
- Ingestion: `python manage.py ingest_documents` → `DocumentService` (PyPDFLoader, cleaning, 500-char chunks / 100 overlap, disease tag) → `VectorStoreService.add_chunks_to_store` (Neo4j `MedicalDocument` nodes with `text`, `embedding`, `source_file`, `page`, `disease`, `source_hash`).
- Cleaning (`_clean_pages`): repeated headers/footers, page-number lines and TOC pages are removed. After a "References"/"Bibliography" heading, following pages are skipped **only while they still look like reference lists** (years, "et al", DOIs, author initials on ≥ 35 % of lines); indexing resumes at the next content page, so multi-chapter books with a reference list per chapter keep their later chapters.
- Unchanged PDFs are skipped by SHA-256 hash (`FORCE_REINGEST=true` to force; needed once for books affected by the cleaning change above).
- ~9,360 chunks currently indexed.

---

## 10. Measured latency (typical, free tiers)

| Turn type | Before optimisation | Now (normal pace) |
|---|---|---|
| Full answer (doctor / self-care / follow-up) | 35–81 s | 8–19 s |
| Emergency | 42 s | 4–8 s |
| Greeting | 57 s | 3–4 s |

With streaming, the first answer tokens appear as soon as Gemini starts writing, so the perceived wait is much shorter than the totals above.

Biggest remaining costs: Gemini answer generation (3–6 s), classifier (1–4 s), Neon DB round-trips (~2.5 s per turn, ~250 ms each from Pakistan to US-East), Neo4j vector search (~1 s).

---

## 11. Known limitations & next steps

1. **Free-tier LLM quotas** cap throughput (~2–3 full turns/min); heavy use falls back to slower providers. Voice input shares the Groq quota.
2. **Warm-up 503**: the first ~50 s after a restart return `warming_up`; the app does not auto-retry yet.
3. **Streamed text can change at the end**: tokens are shown live, but the `final` event (after language-purity, relevance and disclaimer checks) replaces them.
4. **Admin document endpoints are not authenticated** (`admin_list_documents`, `admin_add_document`, `admin_remove_document`).
5. **Validation gate**: for messages > 7 words, `validate_query` may still return "unclear" for vague non-emergency messages (emergencies are protected by the classifier override).
6. **Library links** expire after 10 minutes; anyone holding a valid link can fetch that one book until then.
7. Neo4j is used as a **vector store** only (no graph relationships).

---

## 12. Glossary
- **RAG** — search trusted documents first, then let the LLM answer only from them.
- **BM25** — keyword search. **Vector search** — meaning-based search using embeddings.
- **RRF** — merges two ranked lists into one.
- **SSE** — Server-Sent Events: one HTTP response that keeps sending small events (used to stream replies).
- **Triage** — how urgently the patient should get care.
- **Roman Urdu** — Urdu written in English letters ("Mujhe bukhar hai").
