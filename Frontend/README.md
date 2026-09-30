# SEHAT — Mobile App (Expo / React Native)

Chat-based health assistant app. Talks to the Django backend in `../Backend`. Project overview: [../README.md](../README.md) · Full flow: [../FYP-SEHAT-ARCHITECTURE.md](../FYP-SEHAT-ARCHITECTURE.md)

## Run
```bash
npm install
npx expo start -c      # a = Android emulator, i = iOS simulator, or scan QR with Expo Go
```
The phone and the backend PC must be on the same Wi-Fi (or use an ngrok URL).

## Point the app at the backend
**`app/services/api.jsx` → `getBaseUrl()`** picks the address automatically:
1. In development: the LAN IP Expo serves the bundle from, port 8000 (follows Wi-Fi changes; tunnel hosts are ignored).
2. Otherwise `EXPO_PUBLIC_API_URL`, e.g. `https://<your-ngrok-domain>/api`.
3. Fallback: `http://10.0.2.2:8000/api` on the Android emulator, `http://localhost:8000/api` elsewhere.

That IP (or ngrok domain) must be in `ALLOWED_HOSTS` in the backend `.env`.

## Screens (file-based routing, `app/`)
| File | Screen |
|---|---|
| `index.jsx`, `_layout.jsx` | Entry + root layout |
| `screens/login.jsx`, `signup.jsx`, `forgetPassword.jsx` | Firebase auth |
| `screens/service1.jsx` … `service4.jsx` | Intro / landing pages |
| `screens/(tabs)/home.jsx` | Home — quick-start questions, recent chats, library shortcuts, emergency card |
| `screens/(tabs)/chatbot.jsx` | **Chat** — streaming replies (stop button), voice input, voice playback, copy, triage badge, tappable sources, disclaimer |
| `screens/(tabs)/library.jsx` | Library — curated disease guides + server reference books (read in-app, download, offline list) |
| `screens/(tabs)/profile.jsx` | Profile |
| `screens/admin/AdminDashboard.jsx` | Admin: list / add / remove guideline PDFs |
| `books.jsx` | Curated disease content (English + Roman Urdu) |

Shared components: `components/library/ReferenceBookViewer.jsx` (pdf.js reader in a WebView, opens at a page) and `components/library/libraryUtils.js` (citation page helpers).

## API client (`app/services/api.jsx`)
- Axios instance with `BASE_URL`, 90 s timeout, JSON headers; `SERVER_ORIGIN` is `BASE_URL` without `/api`.
- Request interceptor adds `Authorization: Bearer <Firebase ID token>` from the logged-in user.
- `apiService` methods:
  - Chat: `createChatSession`, `getAllSessions`, `getSessionDetail`, `getSessionMessages`, `sendMessage` (→ `POST /chat/query/`), `streamMessage` (→ `POST /chat/query/stream/`, SSE via `expo/fetch`), `updateSessionTitle`, `deleteSession`, `deleteMessage`, `healthCheck`.
  - Voice: `transcribeAudio` (→ `/chat/voice/transcribe/`), `getTtsAudio` (→ `/chat/voice/tts/`).
  - Library: `getLibraryDocuments` (cached in AsyncStorage for offline use), `getLibraryLink(docId, "read" | "download")`, `downloadLibraryBook` (saves to the documents folder with progress).

## Chat response → UI (`chatbot.jsx`)
- Streaming: `status` events show a progress line, `token` events append text, `final` replaces it with the saved message. If the stream fails before any event arrives (or streaming is unsupported), the app retries with `sendMessage`.
- The bot message's `metadata` drives the bubble:
  - `triage_level`: `Emergency` → red badge, `Doctor` → orange "Consult Doctor", `Self-Care` → green, `null` → no badge.
  - `answer_body` (text), `sources`, `disclaimer`.
- Sources: tapping a title opens that book in the Library; tapping a `p. N` chip opens the reader at page N (pages are 1-based).
- Error handling: `503` → "SEHAT AI is warming up. Please retry in a few seconds." (backend loads models for ~50 s after a restart; no auto-retry yet).
