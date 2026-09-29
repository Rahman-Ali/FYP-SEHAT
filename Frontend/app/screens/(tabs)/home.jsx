//D:\project\Frontend\app\screens\(tabs)\home.jsx
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { app } from "../../../firebase.config";
import { booksData } from "../../books";
import apiService from "../../services/api";

const db = getFirestore(app);
const auth = getAuth(app);

const COLORS = {
  primary: "#0D47A1",
  primaryLight: "#1565C0",
  accent: "#00BCD4",
  bg: "#F5F7FA",
  card: "#FFFFFF",
  text: "#0F172A",
  textSoft: "#334155",
  muted: "#64748B",
  border: "#E2E8F0",
  emergency: "#C62828",
};

const MAX_CONTENT_WIDTH = 760;

const QUICK_STARTS = [
  { label: "Bukhar hai", icon: "thermometer" },
  { label: "Headache", icon: "head-alert-outline" },
  { label: "Pait dard", icon: "stomach" },
  { label: "Khansi", icon: "lungs" },
  { label: "Sore throat", icon: "emoticon-sick-outline" },
  { label: "Ulti aa rahi hai", icon: "water-alert" },
];

const HEALTH_TIPS = [
  { en: "Drink 8–10 glasses of clean water a day, more in hot weather.", ur: "Din mein 8–10 glass saaf pani piyein." },
  { en: "With fever or diarrhoea, sip ORS often to avoid dehydration.", ur: "Bukhar ya dast mein ORS thora thora pitay rahein." },
  { en: "Wash hands with soap for 20 seconds before eating.", ur: "Khana khane se pehle 20 second sabun se haath dhoyein." },
  { en: "Use mosquito nets and repellent to prevent dengue and malaria.", ur: "Dengue aur malaria se bachne ke liye machhar daani istemal karein." },
  { en: "Aim for 7–8 hours of sleep every night.", ur: "Har raat 7–8 ghantay neend lein." },
  { en: "Walk for 30 minutes most days of the week.", ur: "Haftay mein aksar din 30 minute chalein." },
  { en: "Boil or filter drinking water during the monsoon season.", ur: "Barsaat mein pani ubaal kar ya filter kar ke piyein." },
  { en: "Don't take antibiotics without a doctor's prescription.", ur: "Doctor ke nuskhay ke baghair antibiotic na lein." },
  { en: "Eat fruit and vegetables every day for vitamins and fibre.", ur: "Rozana phal aur sabziyan khayein." },
  { en: "Cover your mouth when you cough or sneeze.", ur: "Khansi ya cheenk ke waqt munh dhaanpein." },
  { en: "Keep your vaccinations up to date, including hepatitis B.", ur: "Hepatitis B samait apni vaccination mukammal rakhein." },
  { en: "Store cooked food covered and eat it while fresh.", ur: "Paka hua khana dhaanp kar rakhein aur taza khayein." },
  { en: "Limit sugary drinks and processed food.", ur: "Meethay mashroobat aur processed khana kam karein." },
  { en: "Take short screen breaks: look 20 feet away every 20 minutes.", ur: "Har 20 minute baad screen se nazar hata kar door dekhein." },
];

// Short labels and icons for the library grid (one tile per disease, Part 1 opens)
const SHORT_NAMES = {
  "Dengue Fever": "Dengue",
  "Influenza (Flu)": "Influenza",
  "Tuberculosis (TB)": "Tuberculosis",
  "Typhoid Fever": "Typhoid",
  "Urinary Tract Infection (UTI)": "UTI",
};
const DISEASE_ICONS = [
  [/cold/i, "emoticon-sick-outline"],
  [/dengue/i, "bug-outline"],
  [/diarr/i, "toilet"],
  [/hepatitis/i, "water-alert"],
  [/influenza|flu/i, "virus-outline"],
  [/malaria/i, "bug-outline"],
  [/allergy/i, "allergy"],
  [/tubercul/i, "lungs"],
  [/typhoid/i, "thermometer-alert"],
  [/urinary|uti/i, "bacteria-outline"],
];

const baseDiseaseName = (name) => name.replace(/\s*\(?\s*Part\s*\d+\s*\)?\s*$/i, "").trim();

const LIBRARY_TILES = (() => {
  const seen = new Set();
  return booksData.reduce((tiles, item) => {
    const base = baseDiseaseName(item.name);
    if (seen.has(base)) return tiles;
    seen.add(base);
    const icon = (DISEASE_ICONS.find(([re]) => re.test(base)) || [null, "medical-bag"])[1];
    tiles.push({ id: item.id, label: SHORT_NAMES[base] || base, color: item.color, icon });
    return tiles;
  }, []);
})();

const greetingForNow = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

const tipOfTheDay = () => {
  const now = new Date();
  const dayNumber = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(now.getFullYear(), 0, 0)) / 86400000
  );
  return HEALTH_TIPS[dayNumber % HEALTH_TIPS.length];
};

const formatWhen = (timestamp) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (days <= 0) return `Today, ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString();
};

// Pulsing placeholder block for loading states
const Skeleton = ({ style }) => {
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.skeleton, style, { opacity }]} />;
};

const SectionHeader = ({ title, actionLabel, onAction }) => (
  <View style={styles.sectionHeader}>
    <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
    {actionLabel ? (
      <TouchableOpacity onPress={onAction} style={styles.sectionAction} accessibilityRole="link">
        <Text style={styles.sectionActionText}>{actionLabel}</Text>
        <MaterialCommunityIcons name="chevron-right" size={18} color={COLORS.primaryLight} />
      </TouchableOpacity>
    ) : null}
  </View>
);

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [userName, setUserName] = useState("");
  const [uid, setUid] = useState(null);
  const [recentChats, setRecentChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedOnce = useRef(false);

  const contentWidth = Math.min(width, MAX_CONTENT_WIDTH) - 40;
  const columns = contentWidth >= 600 ? 4 : contentWidth >= 420 ? 3 : 2;
  const tileGap = 12;
  const tileWidth = (contentWidth - tileGap * (columns - 1)) / columns;
  const tip = tipOfTheDay();

  const loadUserName = useCallback(async (user) => {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const fullName = snap.exists() ? snap.data().fullName : null;
      const first = (fullName || user.displayName || "").trim().split(" ")[0];
      setUserName(first);
    } catch (error) {
      console.error("Error fetching user data:", error);
    }
  }, []);

  const loadRecentChats = useCallback(async () => {
    if (!auth.currentUser) {
      setRecentChats([]);
      setChatsLoading(false);
      return;
    }
    apiService.setFirebaseUid(auth.currentUser.uid);
    const sessions = await apiService.getAllSessions(); // newest first; [] on error
    setRecentChats((sessions || []).slice(0, 3));
    setChatsLoading(false);
    hasLoadedOnce.current = true;
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUid(user ? user.uid : null);
      if (user) loadUserName(user);
      else setChatsLoading(false);
    });
    return () => unsubscribe();
  }, [loadUserName]);

  // Refresh recent chats whenever Home is shown (e.g. after chatting)
  useFocusEffect(
    useCallback(() => {
      if (uid) loadRecentChats();
    }, [uid, loadRecentChats])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      if (auth.currentUser) await Promise.all([loadUserName(auth.currentUser), loadRecentChats()]);
    } finally {
      setRefreshing(false);
    }
  };

  // Chat tab reads these once per nonce (new chat / prefill / open session / history)
  const openChat = (params = {}) => {
    router.push({
      pathname: "/screens/chatbot",
      params: { prefill: "", sessionId: "", title: "", openHistory: "", ...params, nonce: String(Date.now()) },
    });
  };

  const openLibrary = (diseaseId) => {
    router.push({
      pathname: "/screens/library",
      params: { diseaseId: diseaseId ? String(diseaseId) : "", nonce: String(Date.now()) },
    });
  };

  const callEmergency = async () => {
    try {
      await Linking.openURL("tel:1122");
    } catch {
      Alert.alert("Call 1122", "Couldn't open the phone app. Please dial 1122 for emergency help.");
    }
  };

  const showSkeleton = chatsLoading && !hasLoadedOnce.current;

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
      <StatusBar style="light" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#FFF"
            colors={[COLORS.primary]}
            progressViewOffset={insets.top}
          />
        }
      >
        {/* Header */}
        <LinearGradient
          colors={[COLORS.primary, COLORS.primaryLight]}
          style={[styles.header, { paddingTop: insets.top + 18 }]}
        >
          <View style={[styles.headerRow, styles.constrained]}>
            <View style={styles.headerText}>
              <Text style={styles.greetingSmall}>{greetingForNow()},</Text>
              <Text style={styles.greetingName} numberOfLines={1}>
                {userName || "there"}
              </Text>
              <Text style={styles.headerSubtitle}>Your personal health assistant</Text>
            </View>
            <TouchableOpacity
              style={styles.avatar}
              onPress={() => router.push({ pathname: "/screens/profile" })}
              accessibilityLabel="Open profile"
            >
              <Image
                source={require("../../../assets/images/sehat_logo.png")}
                style={styles.avatarImage}
                resizeMode="contain"
              />
            </TouchableOpacity>
          </View>
        </LinearGradient>

        <View style={[styles.content, styles.constrained]}>
          {/* Hero */}
          <View style={styles.heroCard}>
            <View style={styles.heroTop}>
              <View style={styles.heroIcon}>
                <MaterialCommunityIcons name="stethoscope" size={26} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle}>How are you feeling today?</Text>
                <Text style={styles.heroSubtitle}>
                  Describe your symptoms in English or Roman Urdu and get guidance in seconds.
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => openChat()}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="chat-plus-outline" size={20} color="#FFF" />
              <Text style={styles.primaryButtonText}>Start symptom check</Text>
            </TouchableOpacity>

            <Text style={styles.quickLabel}>Quick start</Text>
            <View style={styles.chipsWrap}>
              {QUICK_STARTS.map((q) => (
                <TouchableOpacity
                  key={q.label}
                  style={styles.chip}
                  onPress={() => openChat({ prefill: q.label })}
                  activeOpacity={0.8}
                  accessibilityLabel={`Start a chat with: ${q.label}`}
                >
                  <MaterialCommunityIcons name={q.icon} size={16} color={COLORS.primary} />
                  <Text style={styles.chipText}>{q.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Emergency */}
          <TouchableOpacity
            style={styles.emergencyCard}
            onPress={callEmergency}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Emergency. Call 1122"
          >
            <View style={styles.emergencyIcon}>
              <MaterialCommunityIcons name="phone-alert" size={26} color={COLORS.emergency} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.emergencyTitle}>Emergency? Call 1122</Text>
              <Text style={styles.emergencyText}>
                Chest pain, trouble breathing, heavy bleeding or fainting
              </Text>
            </View>
            <MaterialCommunityIcons name="phone" size={22} color="#FFF" />
          </TouchableOpacity>

          {/* Recent chats */}
          <SectionHeader
            title="Recent chats"
            actionLabel={recentChats.length > 0 ? "See all" : null}
            onAction={() => openChat({ openHistory: "1" })}
          />
          {showSkeleton ? (
            [0, 1, 2].map((i) => (
              <View key={i} style={styles.chatRow}>
                <Skeleton style={styles.skeletonIcon} />
                <View style={{ flex: 1, gap: 8 }}>
                  <Skeleton style={{ height: 14, width: "70%" }} />
                  <Skeleton style={{ height: 11, width: "40%" }} />
                </View>
              </View>
            ))
          ) : recentChats.length > 0 ? (
            recentChats.map((chat) => (
              <TouchableOpacity
                key={chat.id}
                style={styles.chatRow}
                onPress={() => openChat({ sessionId: String(chat.id), title: chat.title || "Chat" })}
                activeOpacity={0.75}
              >
                <View style={styles.chatIcon}>
                  <MaterialCommunityIcons name="message-text-outline" size={20} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.chatTitle} numberOfLines={1}>{chat.title || "New Chat"}</Text>
                  <Text style={styles.chatMeta} numberOfLines={1}>
                    {formatWhen(chat.timestamp)}
                    {chat.messageCount ? `  ·  ${chat.messageCount} messages` : ""}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color="#94A3B8" />
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyCard}>
              <MaterialCommunityIcons name="chat-outline" size={40} color="#94A3B8" />
              <Text style={styles.emptyTitle}>No chats yet</Text>
              <Text style={styles.emptyText}>Your conversations with SEHAT will appear here.</Text>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => openChat()}>
                <Text style={styles.secondaryButtonText}>Start your first chat</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Disease library */}
          <SectionHeader title="Disease library" actionLabel="Browse all" onAction={() => openLibrary(null)} />
          <View style={[styles.grid, { gap: tileGap }]}>
            {LIBRARY_TILES.map((tile) => (
              <TouchableOpacity
                key={tile.id}
                style={[styles.tile, { width: tileWidth }]}
                onPress={() => openLibrary(tile.id)}
                activeOpacity={0.8}
                accessibilityLabel={`Open ${tile.label} in the library`}
              >
                <View style={[styles.tileIcon, { backgroundColor: `${tile.color}1F` }]}>
                  <MaterialCommunityIcons name={tile.icon} size={24} color={tile.color} />
                </View>
                <Text style={styles.tileLabel} numberOfLines={2}>{tile.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Health tip */}
          <View style={styles.tipCard}>
            <View style={styles.tipIcon}>
              <MaterialCommunityIcons name="lightbulb-on-outline" size={24} color="#00838F" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tipTitle}>Health tip of the day</Text>
              <Text style={styles.tipText}>{tip.en}</Text>
              <Text style={styles.tipTextUrdu}>{tip.ur}</Text>
            </View>
          </View>

          {/* Footer disclaimer */}
          <View style={styles.footer}>
            <MaterialCommunityIcons name="shield-check-outline" size={16} color={COLORS.muted} />
            <Text style={styles.footerText}>
              SEHAT gives guidance, not a diagnosis. In an emergency, call 1122.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const cardShadow = {
  elevation: 2,
  shadowColor: "#0F172A",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 6,
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1 },
  constrained: { width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingBottom: 72,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  headerText: { flex: 1 },
  greetingSmall: { fontSize: 15, color: "rgba(255,255,255,0.85)", fontWeight: "500" },
  greetingName: { fontSize: 26, fontWeight: "800", color: "#FFF", marginTop: 2 },
  headerSubtitle: { fontSize: 13, color: "rgba(255,255,255,0.8)", marginTop: 4 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#FFF",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.6)",
    overflow: "hidden",
  },
  avatarImage: { width: 40, height: 40 },

  content: { paddingHorizontal: 20 },

  // Hero
  heroCard: {
    marginTop: -52,
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 18,
    ...cardShadow,
    elevation: 4,
  },
  heroTop: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#E3F2FD",
    justifyContent: "center",
    alignItems: "center",
  },
  heroTitle: { fontSize: 19, fontWeight: "800", color: COLORS.text },
  heroSubtitle: { fontSize: 14, color: COLORS.muted, marginTop: 4, lineHeight: 20 },
  primaryButton: {
    marginTop: 16,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  quickLabel: { marginTop: 18, marginBottom: 10, fontSize: 13, fontWeight: "700", color: COLORS.textSoft },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: "#F1F7FE",
    borderWidth: 1,
    borderColor: "#BBDEFB",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chipText: { fontSize: 14, fontWeight: "600", color: COLORS.primary },

  // Emergency
  emergencyCard: {
    marginTop: 16,
    minHeight: 76,
    borderRadius: 18,
    backgroundColor: COLORS.emergency,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    ...cardShadow,
  },
  emergencyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FFF",
    justifyContent: "center",
    alignItems: "center",
  },
  emergencyTitle: { color: "#FFF", fontSize: 17, fontWeight: "800" },
  emergencyText: { color: "rgba(255,255,255,0.92)", fontSize: 13, marginTop: 2, lineHeight: 18 },

  // Sections
  sectionHeader: {
    marginTop: 26,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: COLORS.text },
  sectionAction: { minHeight: 44, flexDirection: "row", alignItems: "center", paddingLeft: 12 },
  sectionActionText: { fontSize: 14, fontWeight: "700", color: COLORS.primaryLight },

  // Recent chats
  chatRow: {
    minHeight: 68,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chatIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#E3F2FD",
    justifyContent: "center",
    alignItems: "center",
  },
  chatTitle: { fontSize: 15, fontWeight: "700", color: COLORS.text },
  chatMeta: { fontSize: 12, color: COLORS.muted, marginTop: 3 },
  skeleton: { backgroundColor: "#E2E8F0", borderRadius: 6 },
  skeletonIcon: { width: 42, height: 42, borderRadius: 21 },
  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: COLORS.text, marginTop: 10 },
  emptyText: { fontSize: 13, color: COLORS.muted, textAlign: "center", marginTop: 4, lineHeight: 19 },
  secondaryButton: {
    marginTop: 14,
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: "#E3F2FD",
    justifyContent: "center",
  },
  secondaryButtonText: { color: COLORS.primary, fontWeight: "700", fontSize: 14 },

  // Library grid
  grid: { flexDirection: "row", flexWrap: "wrap" },
  tile: {
    minHeight: 100,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 12,
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  tileLabel: { marginTop: 10, fontSize: 14, fontWeight: "700", color: COLORS.text },

  // Tip
  tipCard: {
    marginTop: 26,
    backgroundColor: "#E0F7FA",
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    gap: 14,
    borderWidth: 1,
    borderColor: "#B2EBF2",
  },
  tipIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFF",
    justifyContent: "center",
    alignItems: "center",
  },
  tipTitle: { fontSize: 14, fontWeight: "800", color: "#006064" },
  tipText: { fontSize: 14, color: "#004D40", marginTop: 4, lineHeight: 20 },
  tipTextUrdu: { fontSize: 13, color: "#00695C", marginTop: 4, fontStyle: "italic", lineHeight: 19 },

  // Footer
  footer: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  footerText: { fontSize: 12, color: COLORS.muted, textAlign: "center", flexShrink: 1 },
});
