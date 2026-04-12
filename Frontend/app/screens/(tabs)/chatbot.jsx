import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { getAuth } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
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
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import apiService from "../../services/api";

export default function ChatbotScreen() {
  const insets = useSafeAreaInsets(); 
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [sessionId, setSessionId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [currentChatTitle, setCurrentChatTitle] = useState("New Chat");
  const [userUid, setUserUid] = useState(null);

  const scrollViewRef = useRef();

  const quickQuestions = [
    "I have fever and headache",
    "What to do for cough?",
    "Stomach pain remedies",
    "When to visit emergency?",
  ];

  useEffect(() => {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (currentUser) {
      setUserUid(currentUser.uid);
      
      apiService.setFirebaseUid(currentUser.uid);
      console.log('Firebase UID set in API service:', currentUser.uid.substring(0, 10) + '...');
      
      initApp(currentUser.uid);
    } else {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener(
      "keyboardDidShow",
      () => {
        if (scrollViewRef.current) {
          setTimeout(() => {
            scrollViewRef.current.scrollToEnd({ animated: true });
          }, 100);
        }
      },
    );
    return () => keyboardDidShowListener.remove();
  }, []);

  const initApp = async (uid) => {
    try {
      setIsLoading(true);
      await loadAllChatSessions(uid);

      const savedSession = await AsyncStorage.getItem("current_chat_session");
      if (savedSession) {
        const sessionData = JSON.parse(savedSession);
        if (sessionData.session_id) {
          await loadPreviousChat(sessionData.session_id, sessionData.title);
        } else {
          await createNewSession(uid);
        }
      } else {
        await createNewSession(uid);
      }
    } catch (error) {
      console.error("Init Error:", error);
      await createLocalSession();
    } finally {
      setIsLoading(false);
    }
  };

  const loadAllChatSessions = async (uid) => {
    if (!uid) return;
    try {
      const sessions = await apiService.getAllSessions(uid);
      if (sessions && Array.isArray(sessions)) {
        setChatHistory(sessions);
        await AsyncStorage.setItem(
          "api_chat_history",
          JSON.stringify(sessions),
        );
      }
    } catch (error) {
      const local = await AsyncStorage.getItem("local_chat_history");
      if (local) setChatHistory(JSON.parse(local));
    }
  };

  const loadPreviousChat = async (sessionId, title) => {
    try {
      setIsLoading(true);
      setShowHistory(false);
      setSessionId(sessionId);
      setCurrentChatTitle(title || "Chat");

      const serverMessages = await apiService.getSessionMessages(sessionId);

      if (
        serverMessages &&
        Array.isArray(serverMessages) &&
        serverMessages.length > 0
      ) {
        const sortedMessages = serverMessages.sort(
          (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
        );
        const formattedMessages = sortedMessages.map((msg, index) => ({
          id: msg.id || index,
          text: msg.message_text,
          isBot: msg.sender === "bot",
          time: msg.timestamp
            ? new Date(msg.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "Recent",
          condition: msg.possible_condition,
          triage: msg.triage_level,
        }));

        setMessages(formattedMessages);
        await saveMessagesLocally(sessionId, formattedMessages);
      } else {
        const local = await AsyncStorage.getItem(`messages_${sessionId}`);
        if (local) setMessages(JSON.parse(local));
        else setMessages([createMessage("Chat history loaded.", true)]);
      }

      await AsyncStorage.setItem(
        "current_chat_session",
        JSON.stringify({
          session_id: sessionId,
          title: title,
          loaded_at: new Date().toISOString(),
        }),
      );
    } catch (error) {
      Alert.alert("Error", "Could not load chat");
    } finally {
      setIsLoading(false);
    }
  };

  const createNewSession = async (uid = userUid) => {
    if (!uid) return;
    try {
      const result = await apiService.createChatSession(uid);
      if (result && (result.session_id || result.id)) {
        const newId = result.session_id || result.id;
        setSessionId(newId);
        setCurrentChatTitle("New Chat");

        const welcomeMsg = createMessage(
          "Hello! I am SEHAT AI. How can I help you?",
          true,
        );
        setMessages([welcomeMsg]);
        await saveMessagesLocally(newId, [welcomeMsg]);

        await AsyncStorage.setItem(
          "current_chat_session",
          JSON.stringify({
            session_id: newId,
            title: "New Chat",
          }),
        );
      }
    } catch (error) {
      await createLocalSession();
    }
  };

  const createLocalSession = async () => {
    const localId = `local_${Date.now()}`;
    setSessionId(localId);
    setCurrentChatTitle("Offline Chat");
    const msg = createMessage("Offline Mode.", true);
    setMessages([msg]);
    await saveMessagesLocally(localId, [msg]);
  };

  const handleSend = async () => {
  if (!inputText.trim() || !sessionId || isSending) return;

  const userText = inputText.trim();
  setInputText("");

  const userMessage = createMessage(userText, false);
  const updatedMessages = [...messages, userMessage];
  setMessages(updatedMessages);
  setIsSending(true);

  try {
    const response = await apiService.sendMessage(sessionId, userText);
    console.log("API Response:", JSON.stringify(response, null, 2));

    if (messages.length <= 1) {
      const newTitle =
        userText.length > 25 ? userText.substring(0, 25) + "..." : userText;
      setCurrentChatTitle(newTitle);
      await apiService.updateSessionTitle(sessionId, newTitle);
      loadAllChatSessions(userUid);
    }

    const botText = response.botMessage?.message_text || 
                    response.response || 
                    "I've received your message.";
    
    const botCondition = response.botMessage?.metadata?.condition || null;
    const botTriage = response.botMessage?.metadata?.triage_level || null;

    const botMessage = createMessage(
      botText,
      true,
      botCondition,
      botTriage,
    );

    const finalMessages = [...updatedMessages, botMessage];
    setMessages(finalMessages);
    await saveMessagesLocally(sessionId, finalMessages);
  } catch (error) {
    console.error("Send Error:", error);
    const errorMsg = createMessage(
      "Connection Error. Please try again.",
      true,
      "Error",
      "Emergency",
    );
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
            await AsyncStorage.setItem(
              "api_chat_history",
              JSON.stringify(updated),
            );
            if (sessionId === id) createNewSession(userUid);
          } catch (e) {
            Alert.alert("Error", "Failed to delete");
          }
        },
      },
    ]);
  };

  const handleNewChat = () => {
    setMessages([]);
    createNewSession(userUid);
  };

  const toggleHistory = () => {
    setShowHistory(!showHistory);
    if (!showHistory) loadAllChatSessions(userUid);
  };

  const createMessage = (text, isBot, condition = null, triage = null) => ({
    id: Date.now() + Math.random(),
    text,
    isBot,
    condition,
    triage,
    time: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  });

  const saveMessagesLocally = async (sid, msgs) => {
    await AsyncStorage.setItem(`messages_${sid}`, JSON.stringify(msgs));
  };

  useEffect(() => {
    if (scrollViewRef.current && messages.length > 0) {
      setTimeout(
        () => scrollViewRef.current.scrollToEnd({ animated: true }),
        100,
      );
    }
  }, [messages]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00BCD4" />
          <Text style={styles.loadingText}>Loading SEHAT AI...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <StatusBar style="light" />

     
      <View style={styles.header}>
        <TouchableOpacity style={styles.menuButton} onPress={toggleHistory}>
          <MaterialCommunityIcons
            name={showHistory ? "close" : "menu"}
            size={24}
            color="#FFF"
          />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {showHistory ? "Chat History" : currentChatTitle}
          </Text>
          <View style={styles.statusContainer}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    sessionId && !sessionId.startsWith("local")
                      ? "#4CAF50"
                      : "#FF9800",
                },
              ]}
            />
            <Text style={styles.headerStatus}>
              {sessionId && !sessionId.startsWith("local")
                ? "Online"
                : "Offline"}
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {!showHistory && (
            <TouchableOpacity
              style={styles.headerButton}
              onPress={handleNewChat}
            >
              <Ionicons name="add" size={24} color="#FFF" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {showHistory ? (
          <View style={styles.historyContainer}>
            <Text style={styles.historyTitle}>Previous Chats</Text>
            {chatHistory.length === 0 ? (
              <View style={styles.emptyHistory}>
                <MaterialCommunityIcons
                  name="history"
                  size={60}
                  color="#94A3B8"
                />
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
                        <MaterialCommunityIcons
                          name="message-text"
                          size={20}
                          color="#00BCD4"
                        />
                      </View>
                      <View style={styles.historyContent}>
                        <Text style={styles.historyItemTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.historyItemTime}>
                          {new Date(item.timestamp).toLocaleDateString()}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => handleDeleteSession(item.id)}
                    >
                      <MaterialCommunityIcons
                        name="trash-can-outline"
                        size={22}
                        color="#FF5252"
                      />
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </View>
        ) : (
          <>
            <ScrollView
              ref={scrollViewRef}
              style={styles.messagesContainer}
              contentContainerStyle={styles.messagesContent}
              keyboardShouldPersistTaps="handled"
            >
              {messages.length <= 1 && (
                <View style={styles.welcomeSection}>
                  <Text style={styles.welcomeTitle}>
                    How can I help you today?
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.quickQuestionsScroll}
                  >
                    {quickQuestions.map((q, i) => (
                      <TouchableOpacity
                        key={i}
                        style={styles.quickQuestionCard}
                        onPress={() => setInputText(q)}
                      >
                        <MaterialCommunityIcons
                          name="lightbulb-outline"
                          size={20}
                          color="#00BCD4"
                        />
                        <Text
                          style={styles.quickQuestionText}
                          numberOfLines={2}
                        >
                          {q}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {messages.map((message) => (
                <View
                  key={message.id}
                  style={[
                    styles.messageWrapper,
                    message.isBot ? styles.botWrapper : styles.userWrapper,
                  ]}
                >
                  <View
                    style={[
                      styles.messageBubble,
                      message.isBot ? styles.botBubble : styles.userBubble,
                      message.triage === "Emergency" && styles.emergencyBubble,
                      message.triage === "Monitor" && styles.monitorBubble,
                    ]}
                  >
                    <Text
                      style={[
                        styles.messageText,
                        message.isBot ? styles.botText : styles.userText,
                        message.triage === "Emergency" && styles.emergencyText,
                      ]}
                    >
                      {message.text}
                    </Text>

                    {message.condition && (
                      <View style={styles.medicalInfo}>
                        <View style={styles.conditionTag}>
                          <MaterialCommunityIcons
                            name="medical-bag"
                            size={14}
                            color="#00BCD4"
                          />
                          <Text style={styles.conditionText}>
                            {message.condition}
                          </Text>
                        </View>
                        {message.triage && (
                          <View
                            style={[
                              styles.triageTag,
                              message.triage === "Emergency" &&
                                styles.triageEmergency,
                              message.triage === "Monitor" &&
                                styles.triageMonitor,
                              message.triage === "Self-Care" &&
                                styles.triageSelfCare,
                            ]}
                          >
                            <Text
                              style={[
                                styles.triageText,
                                message.triage === "Emergency" && {
                                  color: "#D32F2F",
                                },
                                message.triage === "Monitor" && {
                                  color: "#F57C00",
                                },
                                message.triage === "Self-Care" && {
                                  color: "#388E3C",
                                },
                              ]}
                            >
                              {message.triage}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                    <Text
                      style={[
                        styles.messageTime,
                        message.isBot ? styles.botTime : styles.userTime,
                      ]}
                    >
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
                      <Text
                        style={[
                          styles.messageText,
                          styles.botText,
                          { marginLeft: 10 },
                        ]}
                      >
                        Analyzing symptoms...
                      </Text>
                    </View>
                  </View>
                </View>
              )}
            </ScrollView>

          
            <View
              style={[
                styles.inputContainer,
                { paddingBottom: Math.max(insets.bottom, 10) },
              ]}
            >
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  placeholder="Describe your symptoms..."
                  value={inputText}
                  onChangeText={setInputText}
                  multiline
                  placeholderTextColor="#94A3B8"
                  editable={!isSending}
                />
              </View>
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  (!inputText.trim() || isSending) && styles.sendButtonDisabled,
                ]}
                onPress={handleSend}
                disabled={!inputText.trim() || isSending}
              >
                {isSending ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <MaterialCommunityIcons name="send" size={22} color="#FFF" />
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.disclaimer}>
              <MaterialCommunityIcons
                name="shield-alert"
                size={14}
                color="#FF6B6B"
              />
              <Text style={styles.disclaimerText}>
                AI guidance only. For emergencies, call 1122 immediately.
              </Text>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0D47A1" },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0D47A1",
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: "#FFF",
    fontWeight: "500",
  },
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  header: {
    backgroundColor: "#0D47A1",
    paddingHorizontal: 20,
    paddingVertical: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.1)",
  },
  menuButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  headerCenter: { flex: 1, alignItems: "center", marginHorizontal: 10 },
  headerTitle: { fontSize: 18, fontWeight: "bold", color: "#FFF" },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#4CAF50",
  },
  headerStatus: { fontSize: 12, color: "#00BCD4" },
  headerRight: { flexDirection: "row", gap: 10 },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  historyContainer: { flex: 1, backgroundColor: "#F8FAFC", padding: 16 },
  historyTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#1E293B",
    marginBottom: 20,
  },
  emptyHistory: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyHistoryText: {
    fontSize: 16,
    color: "#94A3B8",
    marginTop: 16,
    fontWeight: "500",
  },
  emptyHistorySubtext: { fontSize: 14, color: "#CBD5E1", marginTop: 8 },
  historyList: { paddingBottom: 20 },
  historyItemWrapper: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  historyItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  deleteButton: {
    marginLeft: 10,
    padding: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  historyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E3F2FD",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  historyContent: { flex: 1 },
  historyItemTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1E293B",
    marginBottom: 4,
  },
  historyItemTime: { fontSize: 12, color: "#94A3B8" },
  welcomeSection: {
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1E293B", 
    marginBottom: 20,
  },
  quickQuestionsScroll: { marginTop: 10 },
  quickQuestionCard: {
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 16,
    marginRight: 12,
    width: 160,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  quickQuestionText: {
    fontSize: 14,
    color: "#334155",
    marginTop: 8,
    fontWeight: "500",
  },
  messagesContainer: { flex: 1, paddingHorizontal: 16 },
  messagesContent: { paddingVertical: 20 },
  messageWrapper: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
    maxWidth: "85%",
  },
  botWrapper: { alignSelf: "flex-start" },
  userWrapper: { alignSelf: "flex-end", flexDirection: "row-reverse" },
  messageBubble: { padding: 16, borderRadius: 20, maxWidth: "100%" },
  botBubble: { backgroundColor: "#E3F2FD", borderTopLeftRadius: 4 },
  userBubble: { backgroundColor: "#00BCD4", borderTopRightRadius: 4 },
  emergencyBubble: {
    backgroundColor: "#FFEBEE",
    borderWidth: 1,
    borderColor: "#FFCDD2",
  },
  monitorBubble: {
    backgroundColor: "#FFF3E0",
    borderWidth: 1,
    borderColor: "#FFE0B2",
  },
  messageText: { fontSize: 15, lineHeight: 22 },
  botText: { color: "#1E293B" },
  userText: { color: "#FFF" },
  emergencyText: { color: "#D32F2F" },
  messageTime: { fontSize: 11, marginTop: 6 },
  botTime: { color: "rgba(0, 0, 0, 0.4)" },
  userTime: { color: "rgba(255, 255, 255, 0.7)" },
  medicalInfo: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.1)",
    gap: 8,
  },
  conditionTag: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 188, 212, 0.1)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
  },
  conditionText: { fontSize: 12, color: "#00BCD4", fontWeight: "600" },
  triageTag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  triageEmergency: { backgroundColor: "rgba(255, 107, 107, 0.1)" },
  triageMonitor: { backgroundColor: "rgba(255, 193, 7, 0.1)" },
  triageSelfCare: { backgroundColor: "rgba(76, 175, 80, 0.1)" },
  triageText: { fontSize: 12, fontWeight: "600" },
  thinkingContainer: { flexDirection: "row", alignItems: "center" },
  inputContainer: {
    backgroundColor: "#FFF",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: "#F8FAFC",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: "#1E293B",
    maxHeight: 100,
    padding: 0,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#00BCD4",
    justifyContent: "center",
    alignItems: "center",
    elevation: 3,
    shadowColor: "#0097A7",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  sendButtonDisabled: { backgroundColor: "#E2E8F0" },
  disclaimer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: "#FFF",
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  disclaimerText: { fontSize: 12, color: "#666", textAlign: "center" },
});
