//D:\project\Frontend\app\screens\(tabs)\chatbot.jsx
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  RecordingPresets,
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as Clipboard from "expo-clipboard";
import { File } from "expo-file-system";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Speech from "expo-speech";
import { StatusBar } from "expo-status-bar";
import { getAuth } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import apiService from "../../services/api";
import { citationPages } from "../../../components/library/libraryUtils";

// Case-insensitive, resilient triage badge resolver
const getTriageBadgeConfig = (triageStr) => {
  if (!triageStr) return null;
  const s = String(triageStr).toLowerCase().trim();
  if (s.includes("emerg")) {
    return { label: "Emergency", bg: "#FFEBEE", border: "#EF9A9A", text: "#C62828", icon: "alert-circle" };
  }
  if (s.includes("self") || s.includes("care") || s.includes("home")) {
    return { label: "Self-Care", bg: "#E8F5E9", border: "#A5D6A7", text: "#2E7D32", icon: "home-heart" };
  }
  if (s.includes("doc") || s.includes("monitor") || s.includes("consult") || s.includes("clinic")) {
    return { label: "Consult Doctor", bg: "#FFF3E0", border: "#FFCC80", text: "#E65100", icon: "doctor" };
  }
  return { label: triageStr, bg: "#E3F2FD", border: "#90CAF9", text: "#1565C0", icon: "information" };
};

const MAX_RECORDING_MS = 60000;
const VOICE_RECORDING_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000 };
const ROMAN_URDU_HINT = /\b(hai|hain|aap|apni|nahi|karein|mein|kisi|baraye|meharbani|jald|takleef|bukhar)\b/gi;

const formatDuration = (ms) => {
  const total = Math.floor((ms || 0) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// Play/Stop on every bot reply that has text (not while it is still streaming)
const isPlayableMessage = (message) =>
  message.isBot && !message.streaming && !!String(message.text || "").trim();

const isRomanUrduMessage = (message) => {
  const lang = String(message.language || "").toLowerCase();
  if (lang.includes("urdu")) return true;
  if (lang === "english") return false;
  return (String(message.text || "").match(ROMAN_URDU_HINT) || []).length >= 2;
};

// answer_body without source lists, citation markers or markdown symbols, plus the short disclaimer
const toSpeakableText = (message) => {
  let text = String(message.text || "").split("--- Sources ---")[0];
  text = text
    .replace(/\[(\d+(\s*[,-]\s*\d+)*)\]/g, "")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/^\s*([-*•>]|\d+[.)-])\s+/gm, "")
    .replace(/[*_`#~|>]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .trim();
  if (message.disclaimer && !text.toLowerCase().includes(message.disclaimer.toLowerCase())) {
    text = `${text}\n${message.disclaimer}`;
  }
  return text.slice(0, Speech.maxSpeechInputLength || 4000);
};

const STREAM_FLUSH_MS = 50;
const STATUS_DELAY_MS = 700;
const NEAR_BOTTOM_PX = 120;

const useBlink = (duration = 500) => {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.15, duration, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, duration]);
  return opacity;
};

// Blinking cursor shown after streamed text
const StreamingCursor = () => {
  const opacity = useBlink(450);
  return <Animated.Text style={[cursorStyles.cursor, { opacity }]}>▍</Animated.Text>;
};

// Animated "typing" dots while waiting for the first token; status text only when given
const TypingStatus = ({ text }) => {
  const opacity = useBlink(400);
  return (
    <View style={cursorStyles.statusRow}>
      <Animated.View style={[cursorStyles.dots, { opacity }]}>
        <View style={cursorStyles.dot} />
        <View style={cursorStyles.dot} />
        <View style={cursorStyles.dot} />
      </Animated.View>
      {text ? <Text style={cursorStyles.statusText}>{text}</Text> : null}
    </View>
  );
};

const cursorStyles = StyleSheet.create({
  cursor: { color: "#0D47A1", fontSize: 15, lineHeight: 22 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 22 },
  dots: { flexDirection: "row", gap: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#00BCD4" },
  statusText: { fontSize: 14, color: "#475569", fontStyle: "italic", flexShrink: 1 },
});

// Formatted medical text renderer supporting bold, italics, section headers, and bullet lists
const FormattedMedicalText = ({ text, isBot, isEmergency, styles }) => {
  if (!text) return null;
  if (!isBot) {
    return <Text style={styles.userText}>{text}</Text>;
  }

  const renderInlineFormatted = (rawLine, keyPrefix) => {
    const parts = rawLine.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <Text key={`${keyPrefix}-${i}`} style={styles.boldInlineText}>
            {part.slice(2, -2)}
          </Text>
        );
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return (
          <Text key={`${keyPrefix}-${i}`} style={styles.italicInlineText}>
            {part.slice(1, -1)}
          </Text>
        );
      }
      return <Text key={`${keyPrefix}-${i}`}>{part}</Text>;
    });
  };

  const lines = text.split("\n");

  return (
    <View style={styles.formattedTextContainer}>
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <View key={idx} style={styles.paragraphSpacer} />;
        }

        // Section header (e.g. **Header:** or ## Header)
        const headerMatch = trimmed.match(/^(\*\*([^*]+)\*\*|##\s*(.+)):?$/);
        if (headerMatch) {
          const headerTitle = (headerMatch[2] || headerMatch[3] || trimmed).replace(/:$/, "");
          return (
            <View key={idx} style={styles.sectionHeaderWrapper}>
              <Text style={styles.sectionHeaderText}>{headerTitle}:</Text>
            </View>
          );
        }

        // Bullet point (e.g. • or - or *)
        const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
        if (bulletMatch) {
          return (
            <View key={idx} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={[styles.messageText, styles.botText, isEmergency && styles.emergencyText, styles.bulletContent]}>
                {renderInlineFormatted(bulletMatch[1], `b-${idx}`)}
              </Text>
            </View>
          );
        }

        // Numbered list item (e.g. 1. or 1-)
        const numberedMatch = trimmed.match(/^(\d+)[\.-]\s+(.*)$/);
        if (numberedMatch) {
          return (
            <View key={idx} style={styles.bulletRow}>
              <Text style={styles.numberPrefix}>{numberedMatch[1]}.</Text>
              <Text style={[styles.messageText, styles.botText, isEmergency && styles.emergencyText, styles.bulletContent]}>
                {renderInlineFormatted(numberedMatch[2], `n-${idx}`)}
              </Text>
            </View>
          );
        }

        // Standard text paragraph
        return (
          <Text
            key={idx}
            style={[
              styles.messageText,
              styles.botText,
              isEmergency && styles.emergencyText,
              styles.paragraphLine,
            ]}
          >
            {renderInlineFormatted(trimmed, `p-${idx}`)}
          </Text>
        );
      })}
    </View>
  );
};

export default function ChatbotScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [sessionId, setSessionId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [currentChatTitle, setCurrentChatTitle] = useState("New Chat");
  const [userUid, setUserUid] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [expandedSources, setExpandedSources] = useState({}); // track per-message source expansion

  // Track if current session is "empty" (only welcome msg or no msgs)
  const isCurrentSessionEmpty = useRef(true);
  const isInitialized = useRef(false); // Prevent double-init (React StrictMode / remount)

  const scrollViewRef = useRef();

  // Voice input / playback / copy
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [playingId, setPlayingId] = useState(null);
  const [ttsLoadingId, setTtsLoadingId] = useState(null);
  const [toastText, setToastText] = useState(null);
  const isRecordingRef = useRef(false);
  const playerRef = useRef(null);
  const playerSubRef = useRef(null);
  const playTokenRef = useRef(0); // bumps on every stop/start so stale callbacks are ignored
  const toastTimerRef = useRef(null);

  // Streaming replies
  const [isStreaming, setIsStreaming] = useState(false);
  const streamControllerRef = useRef(null);
  const streamTextRef = useRef("");
  const streamFlushTimerRef = useRef(null);
  const nearBottomRef = useRef(true);
  const chatEpochRef = useRef(0); // bumps on chat switch so late replies don't land in another chat

  // Deep links from Home: { nonce, prefill?, sessionId?, title?, openHistory? }
  const routeParams = useLocalSearchParams();
  const router = useRouter();
  const handledNonceRef = useRef(null);

  const quickQuestions = [
    "I have fever and headache",
    "What to do for cough?",
    "Stomach pain remedies",
    "When to visit emergency?",
  ];

  useEffect(() => {
    if (isInitialized.current) return; // Prevent double-init
    isInitialized.current = true;

    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (currentUser) {
      setUserUid(currentUser.uid);
      apiService.setFirebaseUid(currentUser.uid);
      initApp(currentUser.uid);
    } else {
      setIsLoading(false);
    }
  }, []);

  // Handle navigation from Home once per nonce, after the initial load finished
  useEffect(() => {
    const nonce = routeParams?.nonce;
    if (!nonce || isLoading || handledNonceRef.current === nonce) return;
    handledNonceRef.current = nonce;
    if (routeParams.sessionId) {
      loadPreviousChat(String(routeParams.sessionId), routeParams.title ? String(routeParams.title) : "Chat");
      return;
    }
    if (routeParams.openHistory) {
      setShowHistory(true);
      if (userUid) loadAllChatSessions(userUid);
      return;
    }
    // New chat, optionally with the input prefilled (never auto-sent)
    createNewSession();
    setShowHistory(false);
    setInputText(routeParams.prefill ? String(routeParams.prefill) : "");
  }, [routeParams?.nonce, isLoading]);

  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener("keyboardDidShow", () => {
      if (scrollViewRef.current) {
        setTimeout(() => scrollViewRef.current.scrollToEnd({ animated: true }), 100);
      }
    });
    return () => keyboardDidShowListener.remove();
  }, []);

  // Abort an in-flight stream (the server still saves the reply) and mark the chat as switched
  const leaveCurrentChat = () => {
    chatEpochRef.current += 1;
    nearBottomRef.current = true;
    streamControllerRef.current?.abort();
  };

  const showToast = useCallback((text) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastText(text);
    toastTimerRef.current = setTimeout(() => setToastText(null), 1600);
  }, []);

  const stopPlayback = useCallback(() => {
    playTokenRef.current += 1;
    Speech.stop();
    playerSubRef.current?.remove();
    playerSubRef.current = null;
    if (playerRef.current) {
      try {
        playerRef.current.pause();
        playerRef.current.remove();
      } catch {}
      playerRef.current = null;
    }
    setPlayingId(null);
    setTtsLoadingId(null);
  }, []);

  const deleteRecordingFile = (uri) => {
    try {
      if (uri) new File(uri).delete();
    } catch {}
  };

  // Stops the recorder without transcribing (screen leave / app background)
  const cancelRecording = useCallback(async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setIsRecording(false);
    try {
      await recorder.stop();
    } catch {}
    deleteRecordingFile(recorder.uri);
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
  }, [recorder]);

  const startRecording = async () => {
    if (isRecordingRef.current || isTranscribing || isSending) return;
    stopPlayback();
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Microphone access needed",
          permission.canAskAgain
            ? "Allow microphone access to ask your question by voice."
            : "Microphone access is turned off for SEHAT. You can enable it in Settings, or type your question instead.",
          permission.canAskAgain
            ? [{ text: "OK" }]
            : [{ text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }]
        );
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      isRecordingRef.current = true;
      setIsRecording(true);
    } catch (error) {
      console.error("Recording Error:", error);
      isRecordingRef.current = false;
      setIsRecording(false);
      Alert.alert("Microphone unavailable", "Couldn't start recording. Please try again or type your question.");
    }
  };

  const stopRecordingAndTranscribe = async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setIsRecording(false);
    const durationMs = recorderState.durationMillis || 0;
    let uri = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch (error) {
      console.error("Stop Recording Error:", error);
    }
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});

    if (!uri) {
      showToast("Recording failed. Please try again.");
      return;
    }
    if (durationMs > 0 && durationMs < 700) {
      deleteRecordingFile(uri);
      showToast("Recording too short. Hold on a bit longer.");
      return;
    }

    setIsTranscribing(true);
    try {
      const transcript = (await apiService.transcribeAudio(uri)).trim();
      if (!transcript) {
        showToast("Couldn't catch that. Please try again.");
      } else {
        // Never auto-send: the user reviews/edits the transcript first
        setInputText((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript));
      }
    } catch (error) {
      const status = error?.response?.status;
      const serverMsg = error?.response?.data?.error;
      let msg = "Couldn't convert your voice to text. Please try again or type your question.";
      if (status === 429) msg = serverMsg || "Voice input is busy. Please wait a minute and try again.";
      else if (status === 400 && serverMsg) msg = serverMsg;
      else if (!error?.response) msg = "Couldn't reach SEHAT AI. Check your connection and try again.";
      Alert.alert("Voice input", msg);
    } finally {
      deleteRecordingFile(uri);
      setIsTranscribing(false);
    }
  };

  const handleMicPress = () => {
    if (isRecordingRef.current) stopRecordingAndTranscribe();
    else startRecording();
  };

  // Auto-stop at 60 s
  useEffect(() => {
    if (isRecording && recorderState.durationMillis >= MAX_RECORDING_MS) {
      stopRecordingAndTranscribe();
    }
  }, [isRecording, recorderState.durationMillis]);

  // Citation -> in-app Library at that book (openAtPage: open the reader directly)
  const openCitation = (source, page, openAtPage) => {
    router.push({
      pathname: "/screens/library",
      params: {
        diseaseId: "",
        doc: source?.doc_id || "",
        title: source?.doc_id ? "" : source?.clean_title || "", // older messages: match by title
        page: page ? String(page) : "",
        open: openAtPage ? "1" : "",
        citeNonce: String(Date.now()),
      },
    });
  };

  const handleCopy = async (message) => {
    const fullText = message.isBot && message.disclaimer
      ? `${message.text}\n\n${message.disclaimer}`
      : message.text;
    try {
      await Clipboard.setStringAsync(fullText || "");
      showToast("Copied");
    } catch {
      showToast("Couldn't copy");
    }
  };

  const handlePlayPress = async (message) => {
    const key = message.id;
    if (playingId === key || ttsLoadingId === key) {
      stopPlayback();
      return;
    }
    stopPlayback(); // only one audio at a time
    const token = playTokenRef.current;
    const isCurrent = () => token === playTokenRef.current;

    if (!isRomanUrduMessage(message)) {
      const finish = () => {
        if (isCurrent()) setPlayingId(null);
      };
      setPlayingId(key);
      Speech.speak(toSpeakableText(message), {
        language: "en-US",
        onDone: finish,
        onStopped: finish,
        onError: () => {
          finish();
          showToast("Couldn't play audio");
        },
      });
      return;
    }

    if (!message.serverId) {
      showToast("Audio isn't available for this message");
      return;
    }
    setTtsLoadingId(key);
    try {
      const uri = await apiService.getTtsAudio(message.serverId);
      if (!isCurrent()) return; // stopped or replaced while loading
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!isCurrent()) return;
      const player = createAudioPlayer({ uri });
      playerRef.current = player;
      playerSubRef.current = player.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish && isCurrent()) stopPlayback();
      });
      player.play();
      setTtsLoadingId(null);
      setPlayingId(key);
    } catch (error) {
      if (!isCurrent()) return;
      setTtsLoadingId(null);
      const status = error?.response?.status;
      showToast(
        status === 403 || status === 404
          ? "Audio isn't available for this message"
          : !error?.response
            ? "Couldn't reach SEHAT AI"
            : "Couldn't prepare audio. Please try again."
      );
    }
  };

  // Stop audio / recording when leaving the screen or backgrounding the app
  useFocusEffect(
    useCallback(() => {
      return () => {
        stopPlayback();
        cancelRecording();
      };
    }, [stopPlayback, cancelRecording])
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        stopPlayback();
        cancelRecording();
      }
    });
    return () => {
      sub.remove();
      stopPlayback();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [stopPlayback, cancelRecording]);

  // Screen unmounts mid-stream: abort it (no-op once the stream has finished)
  useEffect(() => () => streamControllerRef.current?.abort(), []);

  const initApp = async (uid) => {
    try {
      setIsLoading(true);
      await loadAllChatSessions(uid);
      // Only local welcome state here; the server session is created on the first message
      createNewSession();
    } catch (error) {
      console.error("Init Error:", error);
      createNewSession();
    } finally {
      setIsLoading(false);
    }
  };

const loadAllChatSessions = async (uid) => {
  if (!uid) return [];
  try {
    // Fetch the session list only (no messages)
    const sessions = await apiService.getAllSessions();
    
    if (sessions && Array.isArray(sessions)) {
      setChatHistory(sessions);
      await AsyncStorage.setItem("api_chat_history", JSON.stringify(sessions));
      return sessions;
    }
    return [];
  } catch (error) {
    console.error("Session list error:", error);
    const local = await AsyncStorage.getItem("local_chat_history");
    if (local) {
      const parsed = JSON.parse(local);
      setChatHistory(parsed);
      return parsed;
    }
    return [];
  }
};

 const loadPreviousChat = async (sid, title) => {
  try {
    stopPlayback();
    leaveCurrentChat();
    setIsLoading(true);
    setShowHistory(false);
    setSessionId(sid);
    setCurrentChatTitle(title || "Chat");

    const result = await apiService.getSessionMessages(sid);
    
    // API returns {count, messages}, not an array
    const serverMessages = result.messages || result || [];

    if (serverMessages && Array.isArray(serverMessages) && serverMessages.length > 0) {
      const sorted = serverMessages.sort(
        (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
      );
      const formatted = sorted.map((msg, index) => {
        const meta = msg.metadata || {};
        const sources = Array.isArray(meta.sources) ? meta.sources : [];
        const rawTriage = msg.triage_level || meta.triage_level || (sources.length > 0 ? "Doctor" : null);
        return {
          id: msg.id || index,
          text: meta.answer_body || msg.message_text,
          isBot: msg.sender === "bot",
          time: msg.timestamp
            ? new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "Recent",
          condition: msg.possible_condition || meta.condition || null,
          triage: rawTriage,
          sources: sources,
          disclaimer: meta.disclaimer || null,
          serverId: msg.id || null,
          responseType: msg.response_type || meta.response_type || null,
          language: meta.language || null,
        };
      });
      setMessages(formatted);
      // Loaded chat has real messages — not empty
      isCurrentSessionEmpty.current = false;
      await saveMessagesLocally(sid, formatted);
    } else {
      const local = await AsyncStorage.getItem(`messages_${sid}`);
      if (local) {
        const parsed = JSON.parse(local);
        setMessages(parsed);
        isCurrentSessionEmpty.current = parsed.filter(m => !m.isBot).length === 0;
      } else {
        setMessages([createMessage("Chat history loaded.", true)]);
        isCurrentSessionEmpty.current = true;
      }
    }
  } catch (error) {
    Alert.alert("Error", "Could not load chat");
  } finally {
    setIsLoading(false);
  }
};

  const createNewSession = () => {
    // No API call here: the server session is created on the first message (avoids empty sessions)
    stopPlayback();
    leaveCurrentChat();
    setSessionId(null); // null = pending, not yet on server
    setCurrentChatTitle("New Chat");
    const welcomeMsg = createMessage("Hello! I am SEHAT AI. How can I help you?", true);
    setMessages([welcomeMsg]);
    isCurrentSessionEmpty.current = true;
  };

  const createLocalSession = async () => {
    const localId = `local_${Date.now()}`;
    setSessionId(localId);
    setIsOnline(false); // Actually offline — server unreachable
    setCurrentChatTitle("Offline Chat");
    const msg = createMessage("Offline Mode.", true);
    setMessages([msg]);
    isCurrentSessionEmpty.current = true;
    await saveMessagesLocally(localId, [msg]);
  };

  // If the current session is empty, show a message instead of creating a new one
  const handleNewChat = useCallback(() => {
    if (isCurrentSessionEmpty.current) {
      // Already in a new empty chat — inform the user
      setShowHistory(false);
      Alert.alert(
        "Already in New Chat",
        "Type any query",
        [{ text: "OK", style: "default" }]
      );
      return;
    }
    // Real messages exist — safe to create new session
    createNewSession();
  }, []);

// Bot message from the (non-streaming) /query/ response
const botMessageFromResponse = (response) => {
    const botText = response.botMessage?.message_text || response.response || "I've received your message.";
    const botMeta = response.botMessage?.metadata || {};
    const botCondition = botMeta.condition || null;
    const botSources = Array.isArray(botMeta.sources) ? botMeta.sources : [];
    // Resilient triage extraction: ensure medical answers with sources always get a triage badge
    const botTriage = botMeta.triage_level || response.botMessage?.triage_level || (botSources.length > 0 ? "Doctor" : null);
    const botAnswerBody = botMeta.answer_body || botText;
    const botDisclaimer = botMeta.disclaimer || null;

    return createMessage(botAnswerBody, true, botCondition, botTriage, botSources, botDisclaimer, {
      serverId: response.botMessage?.id || null,
      responseType: botMeta.response_type || null,
      language: botMeta.language || null,
    });
};

// Streams the reply into a placeholder bubble; falls back to /query/ once if streaming is unavailable
const getBotReply = async (activeSessionId, userText, recentMessages, epoch) => {
  const placeholderId = Date.now() + Math.random();
  const inThisChat = () => epoch === chatEpochRef.current;
  const updatePlaceholder = (patch) => {
    if (!inThisChat()) return;
    setMessages((prev) => prev.map((m) => (m.id === placeholderId ? { ...m, ...patch } : m)));
  };
  const clearFlush = () => {
    if (streamFlushTimerRef.current) clearTimeout(streamFlushTimerRef.current);
    streamFlushTimerRef.current = null;
  };

  streamTextRef.current = "";
  const controller = new AbortController();
  streamControllerRef.current = controller;
  setMessages((prev) => [
    ...prev,
    { ...createMessage("", true), id: placeholderId, streaming: true, statusText: null, statusVisible: false },
  ]);
  setIsStreaming(true);

  // Dots only at first; status text appears only if no meta/final arrives within 700 ms
  let metaSeen = false;
  let hideStatus = false; // meta said "other" (greeting, small talk, off-topic)
  const statusTimer = setTimeout(() => {
    if (!metaSeen) updatePlaceholder({ statusVisible: true });
  }, STATUS_DELAY_MS);

  try {
    const result = await apiService.streamMessage(activeSessionId, userText, recentMessages, {
      signal: controller.signal,
      onEvent: (event, payload) => {
        if (event === "status") {
          updatePlaceholder({ statusText: payload?.text || null });
        } else if (event === "meta") {
          metaSeen = true;
          if (payload?.response_type === "other") hideStatus = true;
          updatePlaceholder({
            triage: payload?.triage_level || null,
            responseType: payload?.response_type || null,
            language: payload?.language || null,
            ...(hideStatus ? { statusVisible: false } : {}),
          });
        } else if (event === "token") {
          streamTextRef.current += payload?.text || "";
          if (!streamFlushTimerRef.current) {
            streamFlushTimerRef.current = setTimeout(() => {
              streamFlushTimerRef.current = null;
              updatePlaceholder({ text: streamTextRef.current });
            }, STREAM_FLUSH_MS);
          }
        }
      },
    });
    clearFlush();

    if (result.event === "error") {
      const err = new Error(result.payload?.message || "Stream error");
      err.streamMessage = result.payload?.message;
      err.receivedEvents = true;
      throw err;
    }

    // Canonical saved message replaces the streamed draft (same shape as the /query/ path)
    const p = result.payload || {};
    const sources = Array.isArray(p.sources) ? p.sources : [];
    return {
      ...createMessage(
        p.answer_body || p.text || "",
        true,
        null,
        p.triage_level || (sources.length > 0 ? "Doctor" : null),
        sources,
        p.disclaimer || null,
        { serverId: p.message_id || null, responseType: p.response_type || null, language: p.language || null }
      ),
      id: placeholderId,
    };
  } catch (error) {
    clearFlush();
    if (error.aborted) {
      // Stopped by the user: keep what arrived; the server still saves the full reply
      return {
        ...createMessage(streamTextRef.current.trim() || "Response stopped.", true),
        id: placeholderId,
        stopped: true,
      };
    }
    // Nothing reached us (network / HTTP error / unsupported): retry once with the old endpoint
    if (!error.streamMessage && (error.status || error.unsupported || !error.receivedEvents)) {
      if (inThisChat()) setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
      setIsStreaming(false);
      const response = await apiService.sendMessage(activeSessionId, userText, recentMessages);
      return botMessageFromResponse(response);
    }
    throw error;
  } finally {
    clearTimeout(statusTimer);
    streamControllerRef.current = null;
    setIsStreaming(false);
  }
};

const handleStopStreaming = () => {
  streamControllerRef.current?.abort();
};

const handleSend = async () => {
  if (!inputText.trim() || isSending) return;

  const userText = inputText.trim();

  // [SECURITY] Length check
  if (userText.length > 500) {
    Alert.alert("Too Long", "Please keep your message under 500 characters.");
    return;
  }

  setInputText("");

  const userMessage = createMessage(userText, false);
  const updatedMessages = [...messages, userMessage];
  setMessages(updatedMessages);
  setIsSending(true);
  nearBottomRef.current = true;
  const epoch = chatEpochRef.current;

  try {
    let activeSessionId = sessionId;

    // Create session if not exists
    if (!activeSessionId) {
      const result = await apiService.createChatSession(userUid);
      if (!result || (!result.session_id && !result.id)) {
        throw new Error("Failed to create session");
      }
      activeSessionId = result.session_id || result.id;
      setSessionId(activeSessionId);
      setIsOnline(true);
    }

    // Session no longer empty
    isCurrentSessionEmpty.current = false;

    
    const recentMessages = updatedMessages.slice(-6).map(msg => ({
      sender: msg.isBot ? 'bot' : 'user',
      text: msg.text
    }));

    const botMessage = await getBotReply(activeSessionId, userText, recentMessages, epoch);

    // Update the title in the background so the reply shows immediately
    const userMsgCount = updatedMessages.filter(m => !m.isBot).length;
    if (userMsgCount === 1 && epoch === chatEpochRef.current) {
      const newTitle = userText.length > 25 ? userText.substring(0, 25) + "..." : userText;
      setCurrentChatTitle(newTitle);
      apiService.updateSessionTitle(activeSessionId, newTitle).then(() => loadAllChatSessions(userUid));
    }

    const finalMessages = [...updatedMessages, botMessage];
    if (epoch === chatEpochRef.current) setMessages(finalMessages);
    await saveMessagesLocally(activeSessionId, finalMessages);

  } catch (error) {
    console.error("Send Error:", error);
    if (epoch !== chatEpochRef.current) return; // user already switched chats
    isCurrentSessionEmpty.current = false; // don't reset to empty — user's message is there
    // Determine user-facing message based on error type (never show Emergency badge)
    const status = error?.response?.status;
    let errText = "Couldn't connect to SEHAT AI. Please try again.";
    if (error?.streamMessage) {
      errText = error.streamMessage;
    } else if (error?.receivedEvents) {
      errText = "Connection lost while answering. Open this chat again from history to see the full answer.";
    } else if (status === 429) {
      errText = "Too many requests. Please wait a moment and try again.";
    } else if (status === 503) {
      errText = "SEHAT AI is warming up. Please retry in a few seconds.";
    } else if (error?.code === 'ECONNABORTED' || error?.message?.includes('timeout')) {
      errText = "Response is taking longer than usual. Please retry.";
    }
    // triage: null, sources: [] — ensures NO badge is ever shown on error
    const errorMsg = createMessage(errText, true, null, null, [], null);
    setMessages([...updatedMessages, errorMsg]);
  } finally {
    setIsSending(false);
  }
};
  const handleDeleteSession = (id) => {
    Alert.alert("Delete Chat", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await apiService.deleteSession(id);
            const updated = chatHistory.filter((item) => item.id !== id);
            setChatHistory(updated);
            await AsyncStorage.setItem("api_chat_history", JSON.stringify(updated));
            if (sessionId === id) createNewSession();
          } catch {
            Alert.alert("Error", "Failed to delete");
          }
        },
      },
    ]);
  };

const toggleHistory = () => {
  setShowHistory((prev) => {
    const willShow = !prev;
    
    // Fetch only when opening history and not yet loaded
    if (willShow && userUid && chatHistory.length === 0) {
      loadAllChatSessions(userUid);
    }
    
    return willShow;
  });
};

  const createMessage = (text, isBot, condition = null, triage = null, sources = [], disclaimer = null, voice = {}) => ({
    id: Date.now() + Math.random(),
    text,
    isBot,
    condition,
    triage,
    sources,      // [{title, filename, pages:[]}]
    disclaimer,   // plain string or null
    serverId: voice.serverId || null,         // backend message id (needed for server TTS)
    responseType: voice.responseType || null, // "final" | "emergency" | "other"
    language: voice.language || null,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });

  const saveMessagesLocally = async (sid, msgs) => {
    await AsyncStorage.setItem(`messages_${sid}`, JSON.stringify(msgs));
  };

  useEffect(() => {
    // Follow new content only while the user is at (or near) the bottom
    if (scrollViewRef.current && messages.length > 0 && nearBottomRef.current) {
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  const handleMessagesScroll = (e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    nearBottomRef.current =
      contentSize.height - (contentOffset.y + layoutMeasurement.height) < NEAR_BOTTOM_PX;
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00BCD4" />
          <Text style={styles.loadingText}>Loading SEHAT AI...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.menuButton} onPress={toggleHistory} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <MaterialCommunityIcons name={showHistory ? "close" : "menu"} size={24} color="#FFF" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {showHistory ? "Chat History" : currentChatTitle}
          </Text>
          <View style={styles.statusContainer}>
            <View style={[styles.statusDot, { backgroundColor: isOnline ? "#4CAF50" : "#FF9800" }]} />
            <Text style={styles.headerStatus}>
              {isOnline ? "Online" : "Offline"}
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {!showHistory && (
            <TouchableOpacity style={styles.headerButton} onPress={handleNewChat} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="add" size={24} color="#FFF" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Body (KeyboardAvoidingView wraps only the body, not the header) */}
      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {showHistory ? (
          <View style={styles.historyContainer}>
            <Text style={styles.historyTitle}>Previous Chats</Text>
            {chatHistory.length === 0 ? (
              <View style={styles.emptyHistory}>
                <MaterialCommunityIcons name="history" size={60} color="#94A3B8" />
                <Text style={styles.emptyHistoryText}>No chat history yet</Text>
              </View>
            ) : (
              <FlatList
                data={chatHistory}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.historyList}
                renderItem={({ item }) => (
                  <View style={styles.historyItemWrapper}>
                    <TouchableOpacity
                      style={styles.historyItem}
                      onPress={() => loadPreviousChat(item.id, item.title)}
                    >
                      <View style={styles.historyIcon}>
                        <MaterialCommunityIcons name="message-text" size={20} color="#00BCD4" />
                      </View>
                      <View style={styles.historyContent}>
                        <Text style={styles.historyItemTitle} numberOfLines={1}>{item.title}</Text>
                        <Text style={styles.historyItemTime}>
                          {new Date(item.timestamp).toLocaleDateString()}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteButton} onPress={() => handleDeleteSession(item.id)}>
                      <MaterialCommunityIcons name="trash-can-outline" size={22} color="#FF5252" />
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </View>
        ) : (
          <>
            {/* Messages */}
            <ScrollView
              ref={scrollViewRef}
              style={styles.messagesContainer}
              contentContainerStyle={styles.messagesContent}
              keyboardShouldPersistTaps="handled"
              onScroll={handleMessagesScroll}
              scrollEventThrottle={100}
            >
              {messages.length <= 1 && (
                <View style={styles.welcomeSection}>
                  <Text style={styles.welcomeTitle}>How can I help you today?</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickQuestionsScroll}>
                    {quickQuestions.map((q, i) => (
                      <TouchableOpacity key={i} style={styles.quickQuestionCard} onPress={() => setInputText(q)}>
                        <MaterialCommunityIcons name="lightbulb-outline" size={20} color="#00BCD4" />
                        <Text style={styles.quickQuestionText} numberOfLines={2}>{q}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {messages.map((message) => {
                const msgKey = message.id;
                const sourcesOpen = !!expandedSources[msgKey];
                const hasSources = message.isBot && Array.isArray(message.sources) && message.sources.length > 0;
                // Resilient triage badge resolution
                const triageBadge = message.isBot
                  ? getTriageBadgeConfig(message.triage || (hasSources ? "Doctor" : null))
                  : null;

                return (
                  <View
                    key={msgKey}
                    style={[styles.messageWrapper, message.isBot ? styles.botWrapper : styles.userWrapper]}
                  >
                    <View style={[
                      styles.messageBubble,
                      message.isBot ? styles.botBubble : styles.userBubble,
                      message.triage === "Emergency" && styles.emergencyBubble,
                      message.triage === "Monitor" && styles.monitorBubble,
                    ]}>

                      {/* Triage badge */}
                      {triageBadge && (
                        <View style={[styles.triageBadge, { backgroundColor: triageBadge.bg, borderColor: triageBadge.border }]}>
                          <MaterialCommunityIcons name={triageBadge.icon} size={14} color={triageBadge.text} style={{ marginRight: 5 }} />
                          <Text style={[styles.triageBadgeText, { color: triageBadge.text }]}>
                            {triageBadge.label}
                          </Text>
                        </View>
                      )}

                      {/* Streaming: status line until the first token, then the draft with a cursor */}
                      {message.streaming && !message.text ? (
                        <TypingStatus text={message.statusVisible ? message.statusText : null} />
                      ) : (
                        <FormattedMedicalText
                          text={message.text}
                          isBot={message.isBot}
                          isEmergency={triageBadge?.label === "Emergency"}
                          styles={styles}
                        />
                      )}
                      {message.streaming && !!message.text && <StreamingCursor />}
                      {message.stopped && (
                        <Text style={styles.stoppedNote}>
                          Stopped. The full answer is saved in this chat&apos;s history.
                        </Text>
                      )}

                      {/* Legacy condition tag (history messages) */}
                      {message.condition && !triageBadge && (
                        <View style={styles.medicalInfo}>
                          <View style={styles.conditionTag}>
                            <MaterialCommunityIcons name="medical-bag" size={14} color="#00BCD4" />
                            <Text style={styles.conditionText}>{message.condition}</Text>
                          </View>
                        </View>
                      )}

                      {/* Collapsible sources */}
                      {hasSources && (
                        <View style={styles.sourcesContainer}>
                          <TouchableOpacity
                            style={styles.sourcesToggle}
                            onPress={() =>
                              setExpandedSources(prev => ({
                                ...prev,
                                [msgKey]: !prev[msgKey],
                              }))
                            }
                            activeOpacity={0.7}
                          >
                            <MaterialCommunityIcons
                              name={sourcesOpen ? "book-open-page-variant" : "book-outline"}
                              size={14}
                              color="#0D47A1"
                            />
                            <Text style={styles.sourcesToggleText}>
                              {sourcesOpen ? "Hide Sources" : `Medical Sources (${message.sources.length})`}
                            </Text>
                            <MaterialCommunityIcons
                              name={sourcesOpen ? "chevron-up" : "chevron-down"}
                              size={15}
                              color="#546E7A"
                            />
                          </TouchableOpacity>
                          {sourcesOpen && (
                            <View style={styles.sourcesList}>
                              {message.sources.map((src, si) => {
                                const seqNum = src.sequence || si + 1;
                                const titleStr = src.title || `${seqNum}- ${src.clean_title || src.filename}`;
                                const displayTitle = titleStr.match(/^\d+-\s*/) ? titleStr : `${seqNum}- ${titleStr}`;
                                const pages = citationPages(src);
                                return (
                                  <View key={si} style={styles.sourceItem}>
                                    <MaterialCommunityIcons name="file-document-outline" size={14} color="#0D47A1" style={{ marginTop: 2 }} />
                                    <View style={{ flex: 1 }}>
                                      <TouchableOpacity
                                        onPress={() => openCitation(src, pages[0], false)}
                                        accessibilityRole="link"
                                        accessibilityLabel={`Open ${src.clean_title || displayTitle} in the Library`}
                                      >
                                        <Text style={[styles.sourceItemTitle, styles.sourceItemLink]}>
                                          {displayTitle}
                                        </Text>
                                      </TouchableOpacity>
                                      {pages.length > 0 && (
                                        <View style={styles.pageChips}>
                                          {pages.map((p) => (
                                            <TouchableOpacity
                                              key={p}
                                              style={styles.pageChip}
                                              onPress={() => openCitation(src, p, true)}
                                              hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
                                              accessibilityLabel={`Open page ${p}`}
                                            >
                                              <Text style={styles.pageChipText}>p. {p}</Text>
                                            </TouchableOpacity>
                                          ))}
                                        </View>
                                      )}
                                    </View>
                                  </View>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      )}

                      {/* Disclaimer */}
                      {message.isBot && message.disclaimer && (
                        <Text style={styles.bubbleDisclaimer}>{message.disclaimer}</Text>
                      )}

                      <View style={styles.messageFooter}>
                        <Text style={[styles.messageTime, message.isBot ? styles.botTime : styles.userTime]}>
                          {message.time}
                        </Text>
                        <View style={styles.messageActions}>
                          {isPlayableMessage(message) && (
                            <TouchableOpacity
                              style={styles.messageActionBtn}
                              onPress={() => handlePlayPress(message)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              accessibilityLabel={playingId === msgKey ? "Stop audio" : "Play audio"}
                            >
                              {ttsLoadingId === msgKey ? (
                                <ActivityIndicator size="small" color="#0D47A1" />
                              ) : (
                                <MaterialCommunityIcons
                                  name={playingId === msgKey ? "stop-circle-outline" : "play-circle-outline"}
                                  size={20}
                                  color="#0D47A1"
                                />
                              )}
                            </TouchableOpacity>
                          )}
                          {!message.streaming && (
                            <TouchableOpacity
                              style={styles.messageActionBtn}
                              onPress={() => handleCopy(message)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              accessibilityLabel="Copy message"
                            >
                              <MaterialCommunityIcons
                                name="content-copy"
                                size={16}
                                color={message.isBot ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.85)"}
                              />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}

              {isSending && !isStreaming && (
                <View style={styles.botWrapper}>
                  <View style={[styles.messageBubble, styles.botBubble]}>
                    <View style={styles.thinkingContainer}>
                      <ActivityIndicator size="small" color="#00BCD4" />
                      <Text style={[styles.messageText, styles.botText, { marginLeft: 10 }]}>
                        Analyzing symptoms...
                      </Text>
                    </View>
                  </View>
                </View>
              )}
            </ScrollView>

            {toastText && (
              <View style={styles.toast} pointerEvents="none">
                <Text style={styles.toastText}>{toastText}</Text>
              </View>
            )}

            {/* Input bar */}
            <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              {(isRecording || isTranscribing) && (
                <View style={styles.voiceStatusRow}>
                  {isRecording ? (
                    <>
                      <View style={styles.recordingDot} />
                      <Text style={styles.voiceStatusText}>
                        Recording {formatDuration(recorderState.durationMillis)} / {formatDuration(MAX_RECORDING_MS)} · tap stop when done
                      </Text>
                    </>
                  ) : (
                    <>
                      <ActivityIndicator size="small" color="#00BCD4" />
                      <Text style={styles.voiceStatusText}>Converting voice to text...</Text>
                    </>
                  )}
                </View>
              )}
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Describe your symptoms..."
                  value={inputText}
                  onChangeText={setInputText}
                  multiline
                  placeholderTextColor="#94A3B8"
                  editable={!isSending}
                  returnKeyType="default"
                />
                <TouchableOpacity
                  style={[
                    styles.micBtn,
                    isRecording && styles.micBtnRecording,
                    (isSending || isTranscribing) && styles.micBtnDisabled,
                  ]}
                  onPress={handleMicPress}
                  disabled={isSending || isTranscribing}
                  activeOpacity={0.8}
                  accessibilityLabel={isRecording ? "Stop recording" : "Speak your question"}
                >
                  {isTranscribing
                    ? <ActivityIndicator size="small" color="#00BCD4" />
                    : <MaterialCommunityIcons name={isRecording ? "stop" : "microphone"} size={22} color={isRecording ? "#FFF" : "#00BCD4"} />
                  }
                </TouchableOpacity>
                {isStreaming ? (
                  <TouchableOpacity
                    style={[styles.sendBtn, styles.stopStreamBtn]}
                    onPress={handleStopStreaming}
                    activeOpacity={0.8}
                    accessibilityLabel="Stop answer"
                  >
                    <MaterialCommunityIcons name="stop" size={22} color="#FFF" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.sendBtn, (!inputText.trim() || isSending || isRecording || isTranscribing) && styles.sendBtnDisabled]}
                    onPress={handleSend}
                    disabled={!inputText.trim() || isSending || isRecording || isTranscribing}
                    activeOpacity={0.8}
                  >
                    {isSending
                      ? <ActivityIndicator size="small" color="#FFF" />
                      : <MaterialCommunityIcons name="send" size={20} color="#FFF" />
                    }
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.disclaimer}>
                <MaterialCommunityIcons name="shield-alert" size={13} color="#FF6B6B" />
                <Text style={styles.disclaimerText}>
                  AI guidance only. For emergencies, call 1122.
                </Text>
              </View>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0D47A1" },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0D47A1" },
  loadingText: { marginTop: 15, fontSize: 16, color: "#FFF", fontWeight: "500" },

  // Header
  header: {
    backgroundColor: "#0D47A1",
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  menuButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerCenter: { flex: 1, alignItems: "center", marginHorizontal: 8 },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#FFF" },
  statusContainer: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  headerStatus: { fontSize: 11, color: "#00BCD4" },
  headerRight: { width: 40, alignItems: "flex-end" },
  headerButton: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center", alignItems: "center",
  },

  // Body (below header)
  body: { flex: 1, backgroundColor: "#F8FAFC" },

  // History
  historyContainer: { flex: 1, backgroundColor: "#F8FAFC", padding: 16 },
  historyTitle: { fontSize: 20, fontWeight: "700", color: "#1E293B", marginBottom: 16 },
  emptyHistory: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 60 },
  emptyHistoryText: { fontSize: 15, color: "#94A3B8", marginTop: 14, fontWeight: "500" },
  historyList: { paddingBottom: 20 },
  historyItemWrapper: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  historyItem: {
    flex: 1, flexDirection: "row", alignItems: "center",
    backgroundColor: "#FFF", padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: "#E2E8F0",
  },
  deleteButton: { marginLeft: 10, padding: 8, justifyContent: "center", alignItems: "center" },
  historyIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "#E3F2FD", justifyContent: "center", alignItems: "center", marginRight: 12,
  },
  historyContent: { flex: 1 },
  historyItemTitle: { fontSize: 15, fontWeight: "600", color: "#1E293B", marginBottom: 3 },
  historyItemTime: { fontSize: 12, color: "#94A3B8" },

  // Messages
  messagesContainer: { flex: 1, paddingHorizontal: 16 },
  messagesContent: { paddingTop: 16, paddingBottom: 8 },
  welcomeSection: {
    alignItems: "center", paddingVertical: 32, paddingHorizontal: 16,
    backgroundColor: "#FFF", borderRadius: 16, marginBottom: 16,
    borderWidth: 1, borderColor: "#E2E8F0",
  },
  welcomeTitle: { fontSize: 20, fontWeight: "700", color: "#1E293B", marginBottom: 16 },
  quickQuestionsScroll: { marginTop: 4 },
  quickQuestionCard: {
    backgroundColor: "#F8FAFC", padding: 14, borderRadius: 14,
    marginRight: 10, width: 150, borderWidth: 1, borderColor: "#E2E8F0",
  },
  quickQuestionText: { fontSize: 13, color: "#334155", marginTop: 8, fontWeight: "500" },

  messageWrapper: { marginBottom: 14, maxWidth: "85%" },
  botWrapper: { alignSelf: "flex-start" },
  userWrapper: { alignSelf: "flex-end" },
  messageBubble: { padding: 14, borderRadius: 18 },
  botBubble: { backgroundColor: "#E3F2FD", borderTopLeftRadius: 4 },
  userBubble: { backgroundColor: "#00BCD4", borderTopRightRadius: 4 },
  emergencyBubble: { backgroundColor: "#FFEBEE", borderWidth: 1, borderColor: "#FFCDD2" },
  monitorBubble: { backgroundColor: "#FFF3E0", borderWidth: 1, borderColor: "#FFE0B2" },
  messageText: { fontSize: 15, lineHeight: 22 },
  botText: { color: "#1E293B" },
  userText: { color: "#FFF" },
  emergencyText: { color: "#D32F2F" },
  messageTime: { fontSize: 11, marginTop: 6 },
  botTime: { color: "rgba(0,0,0,0.4)" },
  userTime: { color: "rgba(255,255,255,0.7)" },

  // Legacy condition / triage tags (kept for history messages)
  medicalInfo: {
    flexDirection: "row", alignItems: "center", marginTop: 10,
    paddingTop: 10, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.08)", gap: 8, flexWrap: "wrap",
  },
  conditionTag: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(0,188,212,0.1)", paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 10, gap: 4,
  },
  conditionText: { fontSize: 12, color: "#00BCD4", fontWeight: "600" },
  triageTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  triageEmergency: { backgroundColor: "rgba(255,107,107,0.1)" },
  triageMonitor: { backgroundColor: "rgba(255,193,7,0.1)" },
  triageSelfCare: { backgroundColor: "rgba(76,175,80,0.1)" },
  triageText: { fontSize: 12, fontWeight: "600" },

  // Triage badge (shown when triage is set)
  triageBadge: {
    flexDirection: "row", alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1.5,
    marginBottom: 10,
  },
  triageBadgeText: { fontSize: 12, fontWeight: "700", letterSpacing: 0.3 },

  // Markdown and formatted typography
  formattedTextContainer: { width: "100%" },
  paragraphSpacer: { height: 8 },
  paragraphLine: { marginBottom: 5 },
  sectionHeaderWrapper: { marginTop: 10, marginBottom: 5 },
  sectionHeaderText: { fontSize: 15, fontWeight: "700", color: "#0F172A", letterSpacing: 0.2 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 4, marginBottom: 4, paddingLeft: 2 },
  bulletDot: { fontSize: 16, color: "#00BCD4", marginRight: 8, lineHeight: 22, fontWeight: "700" },
  numberPrefix: { fontSize: 14, color: "#00BCD4", marginRight: 6, lineHeight: 22, fontWeight: "700" },
  bulletContent: { flex: 1 },
  boldInlineText: { fontWeight: "700", color: "#0F172A" },
  italicInlineText: { fontStyle: "italic", color: "#475569" },

  // Collapsible sources
  sourcesContainer: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.08)",
  },
  sourcesToggle: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 4,
  },
  sourcesToggleText: {
    fontSize: 12, color: "#0D47A1", fontWeight: "700", flex: 1,
  },
  sourcesList: { marginTop: 8, gap: 6 },
  sourceItem: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "rgba(13,71,161,0.05)",
    borderRadius: 8, padding: 8,
    borderLeftWidth: 3, borderLeftColor: "#0D47A1",
  },
  sourceItemTitle: {
    fontSize: 12, fontWeight: "600", color: "#1E293B", lineHeight: 18,
  },
  sourceItemPages: {
    fontSize: 11, color: "#64748B", marginTop: 2, fontWeight: "500",
  },
  sourceItemLink: { color: "#0D47A1", textDecorationLine: "underline" },
  pageChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  pageChip: {
    minHeight: 28, paddingHorizontal: 10, borderRadius: 14,
    backgroundColor: "#FFF", borderWidth: 1, borderColor: "#BBDEFB", justifyContent: "center",
  },
  pageChipText: { fontSize: 12, fontWeight: "700", color: "#0D47A1" },

  // Disclaimer inside bubble
  bubbleDisclaimer: {
    fontSize: 11, color: "#90A4AE",
    marginTop: 10,
    fontStyle: "italic",
    lineHeight: 16,
  },

  thinkingContainer: { flexDirection: "row", alignItems: "center" },

  // Input bar
  inputBar: {
    backgroundColor: "#FFF",
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  textInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    backgroundColor: "#F1F5F9",
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 12 : 10,
    paddingBottom: Platform.OS === "ios" ? 12 : 10,
    fontSize: 15,
    color: "#1E293B",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#00BCD4",
    justifyContent: "center",
    alignItems: "center",
    elevation: 2,
    shadowColor: "#0097A7",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    marginBottom: 0,
  },
  sendBtnDisabled: { backgroundColor: "#CBD5E1", elevation: 0 },
  stopStreamBtn: { backgroundColor: "#0D47A1" },
  stoppedNote: { fontSize: 11, color: "#64748B", fontStyle: "italic", marginTop: 6 },

  // Voice input
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    justifyContent: "center",
    alignItems: "center",
  },
  micBtnRecording: { backgroundColor: "#EF4444", borderColor: "#EF4444" },
  micBtnDisabled: { opacity: 0.5 },
  voiceStatusRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 8, paddingHorizontal: 4 },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#EF4444" },
  voiceStatusText: { fontSize: 12, color: "#475569", fontWeight: "500" },

  // Message footer: time + copy / play actions
  messageFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  messageActions: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 },
  messageActionBtn: { minWidth: 20, alignItems: "center", justifyContent: "center" },

  // "Copied" toast
  toast: {
    position: "absolute",
    alignSelf: "center",
    bottom: 120,
    backgroundColor: "rgba(15,23,42,0.88)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    zIndex: 10,
    elevation: 10,
  },
  toastText: { color: "#FFF", fontSize: 13, fontWeight: "600" },
  disclaimer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingTop: 8,
    paddingBottom: 2,
  },
  disclaimerText: { fontSize: 11, color: "#94A3B8" },
});