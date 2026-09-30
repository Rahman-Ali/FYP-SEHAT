//D:\project\Frontend\app\services\api.jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import * as LegacyFileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import { getAuth, onAuthStateChanged } from "firebase/auth";

const API_PORT = 8000;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

// In development the backend runs on the same PC as Metro, so reuse the LAN IP
// Expo serves the bundle from. It follows Wi-Fi changes automatically.
const getDevMachineHost = () => {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    Constants.manifest2?.extra?.expoGo?.debuggerHost ||
    Constants.manifest?.debuggerHost;
  const host = hostUri?.split(":")[0];
  // Tunnel hosts (*.exp.direct) point at Metro, not the backend, so only accept raw IPs
  return host && IPV4_RE.test(host) ? host : null;
};

const getBaseUrl = () => {
  if (__DEV__) {
    const host = getDevMachineHost();
    if (host) return `http://${host}:${API_PORT}/api`;
  }
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  // Android emulator reaches the host PC via 10.0.2.2
  const fallbackHost = Platform.OS === "android" ? "10.0.2.2" : "localhost";
  return `http://${fallbackHost}:${API_PORT}/api`;
};

export const BASE_URL = getBaseUrl();
// Server origin (BASE_URL without /api): the library returns relative paths that are joined to it
export const SERVER_ORIGIN = BASE_URL.replace(/\/api\/?$/, "");
const LIBRARY_CACHE_KEY = "library_documents_v1";
console.log("[API Service] Active BASE_URL:", BASE_URL);

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 90000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

const getResolvedUser = (auth, timeoutMs = 3000) => {
  if (auth.currentUser) {
    return Promise.resolve(auth.currentUser);
  }

  return new Promise((resolve) => {
    let unsubscribe;
    const timer = setTimeout(() => {
      if (unsubscribe) unsubscribe();
      resolve(null);
    }, timeoutMs);

    unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        clearTimeout(timer);
        if (unsubscribe) unsubscribe();
        resolve(user);
      },
      () => {
        clearTimeout(timer);
        if (unsubscribe) unsubscribe();
        resolve(null);
      }
    );
  });
};

// Firebase Auth Token Interceptor (runs before logging)
api.interceptors.request.use(async (config) => {
  try {
    const auth = getAuth();
    const user = await getResolvedUser(auth, 3000);
    if (user) {
      const token = await user.getIdToken();
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (err) {
    console.warn("Auth token resolution skipped:", err?.message || err);
  }
  return config;
});

api.interceptors.request.use(
  (config) => {
    console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
    console.log(`Request Body:`, config.data);
    return config;
  },
  (error) => {
    console.error("Request Error:", error);
    return Promise.reject(error);
  },
);

api.interceptors.response.use(
  (response) => {
    console.log(`API Response: ${response.status} ${response.config.url}`);
    return response;
  },
  (error) => {
    const errorMsg = error.response?.data?.error || error.message;
    console.error("Response Error:", error.response?.status, errorMsg);
    return Promise.reject(error);
  },
);


// expo/fetch can throw this from its native "didComplete" listener when a body stream we
// aborted (Stop / unmount) is closed again. It is thrown outside our promise chain, so it is
// filtered at the global handler, and only for a short window after a mid-stream abort.
const STREAM_CLOSE_ERROR_RE = /stream is not in a state that permits close/i;
let ignoreStreamCloseErrorUntil = 0;

const isBenignStreamError = (e) =>
  e?.name === "AbortError" ||
  /aborted|cancel/i.test(String(e?.message || "")) ||
  STREAM_CLOSE_ERROR_RE.test(String(e?.message || e || ""));

if (global.ErrorUtils?.getGlobalHandler && !global.__sehatStreamErrorFilter) {
  global.__sehatStreamErrorFilter = true;
  const previousHandler = global.ErrorUtils.getGlobalHandler();
  global.ErrorUtils.setGlobalHandler((error, isFatal) => {
    if (Date.now() < ignoreStreamCloseErrorUntil && STREAM_CLOSE_ERROR_RE.test(String(error?.message || ""))) {
      return;
    }
    previousHandler?.(error, isFatal);
  });
}

export const apiService = {


  _firebaseUid: null,


  setFirebaseUid: (uid) => {
    apiService._firebaseUid = uid;
    console.log("🔐 Firebase UID set:", uid);
  },


  _getFirebaseUid: () => {
    if (!apiService._firebaseUid) {
      throw new Error("Firebase UID not set. Call setFirebaseUid() first.");
    }
    return apiService._firebaseUid;
  },


  createChatSession: async (firebaseUid) => {
    try {
      const response = await api.post("/chat/sessions/create/", {
        firebase_uid: firebaseUid,
        title: "New Chat",
      });
      return response.data;
    } catch (error) {
      console.error("Create Session Error:", error.message);
      throw error;
    }
  },


  getAllSessions: async () => {
    try {
      const firebaseUid = apiService._getFirebaseUid();

      const response = await api.post("/chat/sessions/list/", {
        firebase_uid: firebaseUid,
      });

      const sessionsData = response.data || [];

      return sessionsData.map((session) => ({
        id: session.id,
        title: session.title || "New Chat",
        preview: "Tap to view history",
        timestamp: session.updated_at || new Date().toISOString(),
        messageCount: session.message_count || 0,
      }));
    } catch (error) {
      console.error("Get Sessions Error:", error.message);
      return [];
    }
  },


  getSessionDetail: async (sessionId) => {
    try {
      const firebaseUid = apiService._getFirebaseUid();


      const response = await api.post("/chat/sessions/detail/", {
        session_id: sessionId,
        firebase_uid: firebaseUid,
      });

      return response.data;
    } catch (error) {
      console.error("Get Session Detail Error:", error.message);
      throw error;
    }
  },


  getSessionMessages: async (sessionId) => {
    try {
      const firebaseUid = apiService._getFirebaseUid();


      const response = await api.post("/chat/messages/list/", {
        session_id: sessionId,
        firebase_uid: firebaseUid,
      });

      const data = response.data;
      return {
        count: data.count || 0,
        messages: data.messages || [],
      };
    } catch (error) {
      console.error("Get History Error:", error.message);
      return { count: 0, messages: [] };
    }
  },


  sendMessage: async (sessionId, messageText, chatHistory = []) => {
    try {
      const firebaseUid = apiService._getFirebaseUid();

      // History is already formatted by the caller
      const recentHistory = (chatHistory || []).slice(-6);

      const response = await api.post("/chat/query/", {
        session_id: sessionId,
        query: messageText,
        firebase_uid: firebaseUid,
        chat_history: recentHistory
      });

      const data = response.data;
      const botMessage = data.bot_message || {};

      return {
        userMessage: data.user_message || null,
        botMessage: {
          id: botMessage.id,
          message_text: botMessage.message_text || data.response || "I've received your message.",
          metadata: botMessage.metadata || {},
          timestamp: botMessage.timestamp,
        },
        status: "success",
      };
    } catch (error) {
      console.error("Send Message Error:", error.message);
      throw error;
    }
  },


  // Streams the reply from /chat/query/stream/ (SSE). onEvent(event, payload) gets
  // status / meta / token / final / error. Resolves with {event, payload} of the last
  // final|error event. Thrown errors carry: status (HTTP), aborted, receivedEvents.
  streamMessage: async (sessionId, messageText, chatHistory = [], { onEvent, signal } = {}) => {
    const firebaseUid = apiService._getFirebaseUid();
    const controller = new AbortController();
    // Set once final/error arrives: a finished stream is never aborted (expo/fetch would
    // then close an already-closed body stream and throw)
    let finished = false;
    const abortMidStream = () => {
      if (finished || controller.signal.aborted) return;
      ignoreStreamCloseErrorUntil = Date.now() + 10000;
      controller.abort();
    };
    const abortFromCaller = () => abortMidStream();
    if (signal) {
      if (signal.aborted) abortMidStream();
      else signal.addEventListener("abort", abortFromCaller);
    }
    // Server sends a keep-alive every 15 s; give up if nothing arrives for 45 s
    let idleTimer = null;
    let timedOut = false;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (finished) return;
        timedOut = true;
        abortMidStream();
      }, 45000);
    };

    let receivedEvents = false;
    try {
      const headers = {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "ngrok-skip-browser-warning": "true",
      };
      const user = await getResolvedUser(getAuth(), 3000);
      if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;

      resetIdle();
      console.log("API Request: POST /chat/query/stream/");
      const response = await expoFetch(`${BASE_URL}/chat/query/stream/`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          session_id: sessionId,
          query: messageText,
          firebase_uid: firebaseUid,
          chat_history: (chatHistory || []).slice(-6),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = new Error(`Stream request failed with status ${response.status}`);
        err.status = response.status;
        try {
          err.data = JSON.parse(await response.text());
        } catch {}
        throw err;
      }
      if (!response.body || typeof response.body.getReader !== "function") {
        const err = new Error("Streaming not supported");
        err.unsupported = true;
        throw err;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let resolveFinal;
      const finalReceived = new Promise((resolve) => {
        resolveFinal = resolve;
      });

      // Reads until done:true. After final/error it only drains (no cancel/releaseLock/abort),
      // so expo/fetch completes and closes the body stream itself.
      const pump = (async () => {
        let last = null;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (last) continue;
          resetIdle();
          buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");

          let sep;
          while (!last && (sep = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            let event = "message";
            const dataLines = [];
            for (const line of block.split("\n")) {
              if (line.startsWith(":")) continue; // keep-alive comment
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
            }
            if (!dataLines.length) continue;
            let payload;
            try {
              payload = JSON.parse(dataLines.join("\n"));
            } catch {
              continue;
            }
            receivedEvents = true;
            onEvent?.(event, payload);
            if (event === "final" || event === "error") {
              last = { event, payload };
              finished = true;
              if (idleTimer) clearTimeout(idleTimer);
              resolveFinal(last);
            }
          }
        }
        return last;
      })();
      // Errors after final don't affect the answer; only unexpected ones are logged
      pump.catch((e) => {
        if (finished && !isBenignStreamError(e)) console.warn("Stream drain error:", e?.message || e);
      });

      // Return as soon as final arrives; the drain keeps running in the background
      const last = await Promise.race([finalReceived, pump]);
      if (!last) {
        const err = new Error("Stream ended before the final answer");
        throw err;
      }
      return last;
    } catch (error) {
      error.receivedEvents = receivedEvents;
      // Anything thrown after our own mid-stream abort (Stop / unmount) is that AbortError
      error.aborted = !timedOut && (signal?.aborted || controller.signal.aborted || error?.name === "AbortError");
      if (timedOut) error.message = "Stream timed out";
      // Stop / unmount: AbortError and expo's stream-close TypeError are expected, stay quiet
      if (!error.aborted && !isBenignStreamError(error)) {
        console.error("Stream Message Error:", error.message);
      }
      throw error;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      if (signal) signal.removeEventListener("abort", abortFromCaller);
    }
  },


  updateSessionTitle: async (sessionId, newTitle) => {
    try {
      const firebaseUid = apiService._getFirebaseUid();

      const response = await api.patch("/chat/sessions/update-title/", {
        session_id: sessionId,
        title: newTitle,
        firebase_uid: firebaseUid,
      });

      console.log("Title updated:", newTitle);
      return response.data;
    } catch (error) {
      console.error("Update Title Error:", error.message);
      return null;
    }
  },


  deleteSession: async (sessionId) => {
    try {
      const firebaseUid = apiService._getFirebaseUid();

      const response = await api.delete("/chat/sessions/delete/", {
        data: {
          session_id: sessionId,
          firebase_uid: firebaseUid,
        },
      });

      return response.data;
    } catch (error) {
      console.error("Delete Session Error:", error.message);
      throw error;
    }
  },


  deleteMessage: async (messageId) => {
    try {
      const firebaseUid = apiService._getFirebaseUid();

      const response = await api.delete("/chat/messages/delete/", {
        data: {
          message_id: messageId,
          firebase_uid: firebaseUid,
        },
      });

      return response.data;
    } catch (error) {
      console.error("Delete Message Error:", error.message);
      throw error;
    }
  },


  // Speech to text; returns the transcript (Roman Urdu or English). Audio is not stored server-side.
  transcribeAudio: async (fileUri) => {
    try {
      const ext = (fileUri.split("?")[0].match(/\.(m4a|webm|wav)$/i)?.[1] || "m4a").toLowerCase();
      const mimeTypes = { m4a: "audio/m4a", webm: "audio/webm", wav: "audio/wav" };
      const form = new FormData();
      form.append("audio", { uri: fileUri, name: `recording.${ext}`, type: mimeTypes[ext] });

      const response = await api.post("/chat/voice/transcribe/", form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      });
      return response.data?.text || "";
    } catch (error) {
      console.error("Transcribe Error:", error.message);
      throw error;
    }
  },


  // Fetches the reply's MP3 (cached on device per message) and returns a local file URI
  getTtsAudio: async (messageId) => {
    try {
      const file = new File(Paths.cache, `tts_${messageId}.mp3`);
      if (file.exists && file.size > 0) return file.uri;

      const response = await api.post(
        "/chat/voice/tts/",
        { message_id: messageId },
        {
          responseType: "arraybuffer",
          headers: { Accept: "audio/mpeg, application/json" },
          timeout: 120000,
        }
      );

      if (file.exists) file.delete();
      file.create();
      file.write(new Uint8Array(response.data));
      return file.uri;
    } catch (error) {
      console.error("TTS Error:", error.message);
      throw error;
    }
  },


  // Reference books per disease. Falls back to the last saved list when the server can't be
  // reached: { library, offline, savedAt }.
  getLibraryDocuments: async () => {
    try {
      const response = await api.get("/chat/library/documents/", { timeout: 20000 });
      const library = response.data || { diseases: [] };
      const savedAt = Date.now();
      AsyncStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify({ library, savedAt })).catch(() => {});
      return { library, offline: false, savedAt };
    } catch (error) {
      console.warn("Library documents unavailable:", error.message);
      try {
        const cached = JSON.parse((await AsyncStorage.getItem(LIBRARY_CACHE_KEY)) || "null");
        if (cached?.library) return { library: cached.library, offline: true, savedAt: cached.savedAt };
      } catch {}
      throw error;
    }
  },


  // Signed, short-lived link for one book. purpose "read" -> { viewerUrl, fileUrl, pages };
  // "download" -> { fileUrl }. 404 means the book was removed.
  getLibraryLink: async (docId, purpose = "read") => {
    const response = await api.get(`/chat/library/documents/${encodeURIComponent(docId)}/link/`, {
      params: { purpose },
      timeout: 20000,
    });
    const data = response.data || {};
    return {
      fileUrl: data.file_path ? `${SERVER_ORIGIN}${data.file_path}` : null,
      viewerUrl: data.viewer_path ? `${SERVER_ORIGIN}${data.viewer_path}` : null,
      pages: data.pages,
    };
  },


  // Downloads a book into the app's documents folder; onProgress(0..1). Returns the local file URI.
  downloadLibraryBook: async (doc, onProgress) => {
    const { fileUrl } = await apiService.getLibraryLink(doc.doc_id, "download");
    const dir = `${LegacyFileSystem.documentDirectory}library/`;
    await LegacyFileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const safeName = String(doc.title || "reference-book").replace(/[^A-Za-z0-9 ._-]+/g, "").trim().slice(0, 80) || "reference-book";
    const target = `${dir}${safeName}.pdf`;

    const task = LegacyFileSystem.createDownloadResumable(
      fileUrl,
      target,
      { headers: { "ngrok-skip-browser-warning": "true" } },
      ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        if (totalBytesExpectedToWrite > 0) onProgress?.(totalBytesWritten / totalBytesExpectedToWrite);
      }
    );
    const result = await task.downloadAsync();
    if (!result || result.status !== 200) {
      await LegacyFileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
      const err = new Error(`Download failed (${result?.status ?? "no response"})`);
      err.status = result?.status;
      throw err;
    }
    return result.uri;
  },


  healthCheck: async () => {
    try {
      const response = await api.get("/chat/health/");
      return response.data;
    } catch (error) {
      console.error("Health Check Error:", error.message);
      return { status: "error" };
    }
  },
};

export default apiService;