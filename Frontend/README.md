# SEHAT — Mobile App (Expo / React Native)

Chat-based health assistant app. Talks to the Django backend in `../Backend`. Project overview: [../README.md](../README.md) · Full flow: [../FYP-SEHAT-ARCHITECTURE.md](../FYP-SEHAT-ARCHITECTURE.md)

## Run
```bash
npm install
npx expo start -c      # a = Android emulator, i = iOS simulator, or scan QR with Expo Go
```
The phone and the backend PC must be on the same Wi-Fi (or use an ngrok URL).

## Point the app at the backend
Edit **`app/services/api.jsx` → `getBaseUrl()`**. It currently returns a fixed address:
```js
return 'http://10.185.171.104:8000/api';
```
Replace it with `http://<your-PC-LAN-IP>:8000/api` (and add that IP to `ALLOWED_HOSTS` in the backend `.env`) or with your ngrok URL + `/api`.

## Screens (file-based routing, `app/`)
| File | Screen |
|---|---|
| `index.jsx`, `_layout.jsx` | Entry + root layout |
| `screens/login.jsx`, `signup.jsx`, `forgetPassword.jsx` | Firebase auth |
| `screens/service1.jsx` … `service4.jsx` | Intro / landing pages |
| `screens/(tabs)/home.jsx` | Home |
| `screens/(tabs)/chatbot.jsx` | **Chat** — triage badge, answer body, collapsible sources, disclaimer |
| `screens/(tabs)/library.jsx` | Disease library / PDF books |
| `screens/(tabs)/profile.jsx` | Profile |
| `screens/admin/AdminDashboard.jsx` | Admin: list / add / remove guideline PDFs |
| `books.jsx` | Curated disease content (English + Roman Urdu) |

## API client (`app/services/api.jsx`)
- Axios instance with `BASE_URL`, 90 s timeout, JSON headers.
- Request interceptor adds `Authorization: Bearer <Firebase ID token>` from the logged-in user.
- `apiService` methods: `createChatSession`, `getAllSessions`, `getSessionDetail`, `getSessionMessages`, `sendMessage` (→ `POST /chat/query/`), `updateSessionTitle`, `deleteSession`, `deleteMessage`, `healthCheck`.

## Chat response → UI (`chatbot.jsx`)
The bot message's `metadata` drives the bubble:
- `triage_level`: `Emergency` → red badge, `Doctor` → orange "Consult Doctor", `Self-Care` → green, `null` → no badge.
- `answer_body` (text), `sources` (title + pages), `disclaimer`.
- Error handling: `503` → "SEHAT AI is warming up. Please retry in a few seconds." (backend loads models for ~50 s after a restart; no auto-retry yet).
