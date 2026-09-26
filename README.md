# SEHAT (صحت) — AI Medical Assistant (English + Roman Urdu)

> **Final Year Project.** A mobile chatbot that answers health questions in **English** or **Roman Urdu**, grounded in WHO / WGO / EAU guideline PDFs, with page-level citations and triage (`Emergency` / `Doctor` / `Self-Care`).

For the full technical walkthrough (every step of a request, with file and function names) see **[FYP-SEHAT-ARCHITECTURE.md](FYP-SEHAT-ARCHITECTURE.md)**.

---

## 1. What it does (in 30 seconds)

1. User logs in (Firebase) on the **Expo / React Native** app and types a message.
2. App sends it to the **Django** backend (`POST /api/chat/query/`) with a Firebase ID token.
3. Backend runs one **intake classifier** LLM call that decides: emergency? greeting / small talk? off-topic? needs a follow-up question? enough info to answer? It also assigns the **triage level**.
4. If an answer is needed: **hybrid search** (BM25 + Neo4j vectors + SBERT rerank) over the guideline PDFs → **Gemini** writes the answer → citations + disclaimer are attached.
5. User message, bot message, triage and sources are saved in **PostgreSQL (Neon)** and returned to the app.

---

## 2. Tech stack

| Layer | Technology | Where |
|---|---|---|
| Mobile app | React Native + Expo Router, Axios | `Frontend/app/` |
| Auth | Firebase Auth (client) + Firebase Admin token verification (server) | `Frontend/firebase.config.js`, `chat/services.py` → `AuthenticationService` |
| API | Django 4.2 + Django REST Framework | `Backend/sehat_backend/chat/views.py`, `chat/urls.py` |
| Chat storage | PostgreSQL on **Neon** (cloud) | `chat/models.py` (`ChatSession`, `Message`) |
| Vector store | **Neo4j Aura** (cloud), index `medical_docs`, label `MedicalDocument` | `chat/vector_store_service.py` |
| Keyword search | In-memory BM25 (rebuilt from Neo4j at startup) | `chat/vector_store_service.py` |
| Embeddings / rerank | `sentence-transformers/all-MiniLM-L6-v2` (local CPU) | `chat/vector_store_service.py` |
| Answer generation | Google **Gemini** `gemini-3.1-flash-lite` (fallback: Groq) | `llm_service.py` → `_call_generation_llm` |
| Auxiliary LLM calls (classify, validate, language, relevance, greeting) | **Groq** `openai/gpt-oss-20b` → **Gemini** → OpenAI (3rd tier) | `llm_service.py` → `_call_aux_llm` |

---

## 3. Repository layout (real file names)

```
FYP-SEHAT-NEW/
├── README.md                         ← this file
├── FYP-SEHAT-ARCHITECTURE.md         ← full request flow & design
├── Backend/
│   ├── requirements.txt              ← pinned Python deps (keep venv in sync!)
│   ├── medical_documents/            ← 15 guideline PDFs (10 diseases)
│   └── sehat_backend/
│       ├── manage.py
│       ├── .env                      ← secrets (git-ignored, never commit)
│       ├── secrets/                  ← Firebase service account (git-ignored)
│       ├── sehat_backend/
│       │   ├── settings.py           ← DB (Neon, conn health checks), ALLOWED_HOSTS, DRF
│       │   ├── urls.py               ← mounts /api/chat/
│       │   └── health_middleware.py  ← /healthz (always 200), /readyz (503 until warm)
│       └── chat/
│           ├── urls.py               ← all /api/chat/... routes
│           ├── views.py              ← endpoints, token check, rate limit, 503 warm-up gate
│           ├── services.py           ← ChatService.process_user_query (memory, facts, DB saves)
│           ├── rag_service.py        ← RAGService: retrieve_context + generate_with_context
│           ├── llm_service.py        ← LLMService: all prompts & provider chains
│           ├── vector_store_service.py ← hybrid_search (BM25 + Neo4j + SBERT rerank)
│           ├── document_service.py   ← PDF load, clean, chunk, disease tags
│           ├── warmup.py             ← background model load + BM25 build at startup
│           ├── models.py             ← ChatSession, Message
│           ├── serializers.py        ← exposes triage_level, sources, answer_body
│           ├── tests_deploy.py       ← automated tests
│           └── management/commands/
│               ├── ingest_documents.py      ← index PDFs into Neo4j
│               └── update_display_titles.py ← fix citation titles on existing nodes
└── Frontend/
    ├── app.json, package.json
    ├── firebase.config.js
    └── app/
        ├── _layout.jsx, index.jsx
        ├── services/api.jsx          ← Axios client + BASE_URL + all API calls
        └── screens/
            ├── login.jsx, signup.jsx, forgetPassword.jsx
            ├── (tabs)/chatbot.jsx     ← chat UI (triage pill, sources, disclaimer)
            ├── (tabs)/home.jsx, library.jsx, profile.jsx
            └── admin/AdminDashboard.jsx ← add/remove guideline documents
```

---

## 4. API endpoints (`/api/chat/…`)

Session, message and query endpoints require `Authorization: Bearer <Firebase ID token>` (verified server-side with Firebase Admin).
> ⚠️ The three `admin/documents/*` endpoints currently do **not** verify a token — anyone who can reach the server can list/add/remove PDFs. Add auth before exposing the server publicly.

| Method | Path | Purpose |
|---|---|---|
| GET | `health/` | Public health check |
| POST | `sessions/create/` | New chat session |
| POST | `sessions/list/` | List the user's sessions |
| POST | `sessions/detail/` | One session |
| DELETE | `sessions/delete/` | Delete a session |
| PATCH | `sessions/update-title/` | Rename a session |
| POST | `messages/list/` | Messages of a session |
| DELETE | `messages/delete/` | Delete a message |
| POST | `query/` | **Ask a question** (main pipeline) |
| GET | `admin/documents/list/` | List indexed PDFs |
| POST | `admin/documents/add/` | Upload + index a PDF |
| DELETE | `admin/documents/remove/` | Remove a PDF and its chunks |

Other routes: `/healthz` (always 200) and `/readyz` (503 until warm-up finishes).

---

## 5. Setup

### Backend
```bash
cd Backend
python -m venv venv
venv\Scripts\activate            # Windows  (macOS/Linux: source venv/bin/activate)
pip install -r requirements.txt  # re-run after every pull: a stale venv breaks the OpenAI fallback
cd sehat_backend
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```
Wait for `[warmup] SUCCESS` in the console (~50 s: embedding models ~36 s + BM25 index ~12 s). Until then `/api/chat/query/` returns **503 `warming_up`** by design.

Index documents (only when PDFs change; unchanged files are skipped by SHA-256 hash):
```bash
python manage.py ingest_documents                       # all PDFs in Backend/medical_documents/
python manage.py ingest_documents --file 1-DENGUE-WHO-BOOK.pdf
```

### Backend `.env` (`Backend/sehat_backend/.env`) — variable names only
```env
SECRET_KEY=...
DJANGO_DEBUG=False
ALLOWED_HOSTS=localhost,127.0.0.1,<your-LAN-IP>,<your-ngrok-domain>
DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require

NEO4J_URI=neo4j+s://<id>.databases.neo4j.io
NEO4J_USERNAME=...
NEO4J_PASSWORD=...
NEO4J_DATABASE=...

GOOGLE_API_KEY=...        # Gemini (answers + aux fallback)
GROQ_API_KEY=...          # Groq (first aux provider)
OPEN_AI_API_KEY=...       # optional 3rd-tier fallback (needs paid credits)
AUX_LLM_PROVIDER_ORDER=groq_first   # or gemini_first

FIREBASE_SERVICE_ACCOUNT_KEY=secrets/firebase-service-account.json
FIREBASE_PROJECT_ID=sehat-538ee
FORCE_REINGEST=false
```
> The phone's server address **must** be in `ALLOWED_HOSTS`, otherwise every request gets Django's `400 Bad Request`.

### Frontend
```bash
cd Frontend
npm install
npx expo start -c
```
The backend address is set in **`Frontend/app/services/api.jsx` → `getBaseUrl()`**. It currently returns a fixed LAN address (`http://10.185.171.104:8000/api`); change it to your PC's IP (same Wi-Fi as the phone) or your ngrok URL.

---

## 6. Testing
```bash
cd Backend/sehat_backend
python manage.py test chat.tests_deploy
```
Covers health middleware, warm-up state machine, ingestion hash safety, citation titles, clarification rounds, contextual memory and conversational reasoning (18 DB-free tests + DB tests on in-memory SQLite).

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `400 Bad Request` (143-byte HTML) on every call | Server IP not in `ALLOWED_HOSTS` | Add it to `.env`, restart |
| `503 warming_up` right after starting the server | Models / BM25 still loading (~50 s) | Wait for `[warmup] SUCCESS`, then retry |
| Slow replies, logs show `Groq rate-limited` | Groq free tier: 8,000 tokens/min, 200,000 tokens/day | Automatic: Groq is skipped until its limit resets and Gemini answers instead |
| Gemini `429 ResourceExhausted` | Gemini free tier requests/min | Space out requests; limits are per minute |
| OpenAI fallback `insufficient_quota` | No credits on the OpenAI key | Skipped automatically for 1 h; add credits or ignore |
| `'ChatOpenAI' object has no attribute '_add_version'` | venv out of sync with `requirements.txt` | `pip install -r requirements.txt` |
| First request after idle fails with `OperationalError` | Neon closed the idle DB connection | Handled by `conn_health_checks=True` in `settings.py` |
| `TimeoutError: timed out` tracebacks in `runserver` | Phone's idle keep-alive socket closed by the dev server | Harmless (dev server only) |

---

## 8. Known limits
- Free LLM tiers cap throughput (roughly 2–3 full chat turns per minute before falling back to slower providers).
- Streaming responses are not implemented: the app waits for the full JSON (see architecture doc §9).
- Knowledge base covers 10 diseases; other medical topics get a "please see a doctor" style reply.

---

## Contributors
- **Rahman Ali** — Lead developer & RAG pipeline
- **FYP Team SEHAT**
