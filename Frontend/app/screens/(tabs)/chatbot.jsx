//D:\project\Frontend\app\screens\(tabs)\chatbot.jsx
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { getAuth } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
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

  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener("keyboardDidShow", () => {
      if (scrollViewRef.current) {
        setTimeout(() => scrollViewRef.current.scrollToEnd({ animated: true }), 100);
      }
    });
    return () => keyboardDidShowListener.remove();
  }, []);

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

    const response = await apiService.sendMessage(
      activeSessionId,
      userText,
      recentMessages
    );

    // Update the title in the background so the reply shows immediately
    const userMsgCount = updatedMessages.filter(m => !m.isBot).length;
    if (userMsgCount === 1) {
      const newTitle = userText.length > 25 ? userText.substring(0, 25) + "..." : userText;
      setCurrentChatTitle(newTitle);
      apiService.updateSessionTitle(activeSessionId, newTitle).then(() => loadAllChatSessions(userUid));
    }

    const botText = response.botMessage?.message_text || response.response || "I've received your message.";
    const botMeta = response.botMessage?.metadata || {};
    const botCondition = botMeta.condition || null;
    const botSources = Array.isArray(botMeta.sources) ? botMeta.sources : [];
    // Resilient triage extraction: ensure medical answers with sources always get a triage badge
    const botTriage = botMeta.triage_level || response.botMessage?.triage_level || (botSources.length > 0 ? "Doctor" : null);
    const botAnswerBody = botMeta.answer_body || botText;
    const botDisclaimer = botMeta.disclaimer || null;

    const botMessage = createMessage(botAnswerBody, true, botCondition, botTriage, botSources, botDisclaimer);
    const finalMessages = [...updatedMessages, botMessage];
    setMessages(finalMessages);
    await saveMessagesLocally(activeSessionId, finalMessages);

  } catch (error) {
    console.error("Send Error:", error);
    isCurrentSessionEmpty.current = false; // don't reset to empty — user's message is there
    // Determine user-facing message based on error type (never show Emergency badge)
    const status = error?.response?.status;
    let errText = "Couldn't connect to SEHAT AI. Please try again.";
    if (status === 429) {
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

  const createMessage = (text, isBot, condition = null, triage = null, sources = [], disclaimer = null) => ({
    id: Date.now() + Math.random(),
    text,
    isBot,
    condition,
    triage,
    sources,      // [{title, filename, pages:[]}]
    disclaimer,   // plain string or null
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });

  const saveMessagesLocally = async (sid, msgs) => {
    await AsyncStorage.setItem(`messages_${sid}`, JSON.stringify(msgs));
  };

  useEffect(() => {
    if (scrollViewRef.current && messages.length > 0) {
      setTimeout(() => scrollViewRef.current.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

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

                      {/* Formatted answer body */}
                      <FormattedMedicalText
                        text={message.text}
                        isBot={message.isBot}
                        isEmergency={triageBadge?.label === "Emergency"}
                        styles={styles}
                      />

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
                                return (
                                  <View key={si} style={styles.sourceItem}>
                                    <MaterialCommunityIcons name="file-document-outline" size={14} color="#0D47A1" style={{ marginTop: 2 }} />
                                    <View style={{ flex: 1 }}>
                                      <Text style={styles.sourceItemTitle}>
                                        {displayTitle}
                                      </Text>
                                      {src.pages && src.pages.length > 0 && (
                                        <Text style={styles.sourceItemPages}>
                                          Pages: {src.pages.join(", ")}
                                        </Text>
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

                      <Text style={[styles.messageTime, message.isBot ? styles.botTime : styles.userTime]}>
                        {message.time}
                      </Text>
                    </View>
                  </View>
                );
              })}

              {isSending && (
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

            {/* Input bar */}
            <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
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
                  style={[styles.sendBtn, (!inputText.trim() || isSending) && styles.sendBtnDisabled]}
                  onPress={handleSend}
                  disabled={!inputText.trim() || isSending}
                  activeOpacity={0.8}
                >
                  {isSending
                    ? <ActivityIndicator size="small" color="#FFF" />
                    : <MaterialCommunityIcons name="send" size={20} color="#FFF" />
                  }
                </TouchableOpacity>
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