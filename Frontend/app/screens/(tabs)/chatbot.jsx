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
  const [isOnline, setIsOnline] = useState(true); // Tracks real server connectivity

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
      // Session is NOT created on server here — only local welcome state
      // Server session will be created lazily when user sends first message
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
      const sessions = await apiService.getAllSessions(uid);
      if (sessions && Array.isArray(sessions)) {
        // Filter + clean: check each session for real user messages
        // Delete empty sessions from server so they don't accumulate
        const validSessions = [];
        const deletePromises = [];

        for (const session of sessions) {
          try {
            const msgs = await apiService.getSessionMessages(session.id);
            const hasUserMsg = msgs && msgs.some((m) => m.sender !== "bot");
            if (hasUserMsg) {
              validSessions.push(session);
            } else {
              // Empty session — delete from server silently
              deletePromises.push(apiService.deleteSession(session.id).catch(() => {}));
            }
          } catch {
            // If we can't check, keep it to be safe
            validSessions.push(session);
          }
        }

        // Fire deletes in background
        Promise.all(deletePromises);

        setChatHistory(validSessions);
        await AsyncStorage.setItem("api_chat_history", JSON.stringify(validSessions));
        return validSessions;
      }
      return [];
    } catch (error) {
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

      const serverMessages = await apiService.getSessionMessages(sid);

      if (serverMessages && Array.isArray(serverMessages) && serverMessages.length > 0) {
        const sorted = serverMessages.sort(
          (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
        );
        const formatted = sorted.map((msg, index) => ({
          id: msg.id || index,
          text: msg.message_text,
          isBot: msg.sender === "bot",
          time: msg.timestamp
            ? new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "Recent",
          condition: msg.possible_condition,
          triage: msg.triage_level,
        }));
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
    // DO NOT call API here — session only created on server when first message is sent
    // This prevents empty sessions from being stored in the database
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

  // FIX 1: If current session is empty, show message instead of creating new session
  const handleNewChat = useCallback(() => {
    if (isCurrentSessionEmpty.current) {
      // Already in a new empty chat — inform the user
      setShowHistory(false);
      Alert.alert(
        "Already in New Chat",
        "Aap pehle se ek naye chat mein hain. Koi message type karein.",
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
    setInputText("");

    const userMessage = createMessage(userText, false);
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setIsSending(true);

    try {
      let activeSessionId = sessionId;

      // If sessionId is null — this is the first message, create session on server NOW
      if (!activeSessionId) {
        const result = await apiService.createChatSession(userUid);
        if (!result || (!result.session_id && !result.id)) {
          throw new Error("Failed to create session");
        }
        activeSessionId = result.session_id || result.id;
        setSessionId(activeSessionId);
        setIsOnline(true); // Connected to server successfully
      }

      // Mark session as no longer empty
      isCurrentSessionEmpty.current = false;

      const response = await apiService.sendMessage(activeSessionId, userText);

      // On first real user message — update title and refresh history
      const userMsgCount = updatedMessages.filter(m => !m.isBot).length;
      if (userMsgCount === 1) {
        const newTitle = userText.length > 25 ? userText.substring(0, 25) + "..." : userText;
        setCurrentChatTitle(newTitle);
        await apiService.updateSessionTitle(activeSessionId, newTitle);
        loadAllChatSessions(userUid);
      }

      const botText =
        response.botMessage?.message_text ||
        response.response ||
        "I've received your message.";
      const botCondition = response.botMessage?.metadata?.condition || null;
      const botTriage = response.botMessage?.metadata?.triage_level || null;

      const botMessage = createMessage(botText, true, botCondition, botTriage);
      const finalMessages = [...updatedMessages, botMessage];
      setMessages(finalMessages);
      await saveMessagesLocally(activeSessionId, finalMessages);
    } catch (error) {
      console.error("Send Error:", error);
      // Revert empty flag so user can retry
      isCurrentSessionEmpty.current = true;
      const errorMsg = createMessage("Connection Error. Please try again.", true, "Error", "Emergency");
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
    setShowHistory((prev) => !prev);
    if (!showHistory) loadAllChatSessions(userUid);
  };

  const createMessage = (text, isBot, condition = null, triage = null) => ({
    id: Date.now() + Math.random(),
    text,
    isBot,
    condition,
    triage,
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

      {/* Body — FIX 3: KeyboardAvoidingView wraps only the body, not the header */}
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

              {messages.map((message) => (
                <View
                  key={message.id}
                  style={[styles.messageWrapper, message.isBot ? styles.botWrapper : styles.userWrapper]}
                >
                  <View style={[
                    styles.messageBubble,
                    message.isBot ? styles.botBubble : styles.userBubble,
                    message.triage === "Emergency" && styles.emergencyBubble,
                    message.triage === "Monitor" && styles.monitorBubble,
                  ]}>
                    <Text style={[
                      styles.messageText,
                      message.isBot ? styles.botText : styles.userText,
                      message.triage === "Emergency" && styles.emergencyText,
                    ]}>
                      {message.text}
                    </Text>
                    {message.condition && (
                      <View style={styles.medicalInfo}>
                        <View style={styles.conditionTag}>
                          <MaterialCommunityIcons name="medical-bag" size={14} color="#00BCD4" />
                          <Text style={styles.conditionText}>{message.condition}</Text>
                        </View>
                        {message.triage && (
                          <View style={[
                            styles.triageTag,
                            message.triage === "Emergency" && styles.triageEmergency,
                            message.triage === "Monitor" && styles.triageMonitor,
                            message.triage === "Self-Care" && styles.triageSelfCare,
                          ]}>
                            <Text style={[
                              styles.triageText,
                              message.triage === "Emergency" && { color: "#D32F2F" },
                              message.triage === "Monitor" && { color: "#F57C00" },
                              message.triage === "Self-Care" && { color: "#388E3C" },
                            ]}>
                              {message.triage}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                    <Text style={[styles.messageTime, message.isBot ? styles.botTime : styles.userTime]}>
                      {message.time}
                    </Text>
                  </View>
                </View>
              ))}

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

            {/* FIX 3: Input bar — clean layout, no overlapping icons */}
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
  thinkingContainer: { flexDirection: "row", alignItems: "center" },

  // FIX 3: Input bar — completely rebuilt
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
    // No icons inside — clean field
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
    // Aligned with bottom of input
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