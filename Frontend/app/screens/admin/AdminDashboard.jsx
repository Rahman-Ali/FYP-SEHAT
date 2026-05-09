//D:\project\Frontend\app\screens\admin\AdminDashboard.jsx
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { getAuth, signOut } from "firebase/auth";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useRef, useState, memo } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { auth, getUserRole } from "../../../firebase.config";
//itel   192.168.4.134
//faculty   10.10.40.60

const BASE_URL = "http://10.10.40.104:8000/api/chat";

// ─── Doc Card (memoized — skips re-render unless its own props change) ────────
const DocCard = memo(function DocCard({ item, onRemove, isRemoving }) {
  const isPending = !item.indexed;
  return (
    <View style={styles.docCard}>
      <View style={[styles.docStripe, { backgroundColor: isPending ? "#F59E0B" : "#10B981" }]} />
      <View style={[styles.docIconWrap, { backgroundColor: isPending ? "#FEF3C7" : "#D1FAE5" }]}>
        <MaterialCommunityIcons
          name="file-pdf-box"
          size={26}
          color={isPending ? "#F59E0B" : "#10B981"}
        />
      </View>
      <View style={styles.docInfo}>
        <Text style={styles.docName} numberOfLines={1} ellipsizeMode="tail">
          {item.filename}
        </Text>
        <View style={styles.docTagRow}>
          <View style={[styles.statusPill, isPending ? styles.pillPending : styles.pillIndexed]}>
            <View style={[styles.pillDot, { backgroundColor: isPending ? "#F59E0B" : "#10B981" }]} />
            <Text style={[styles.pillText, { color: isPending ? "#D97706" : "#059669" }]}>
              {isPending ? "Pending" : "Indexed"}
            </Text>
          </View>
          <Text style={styles.chunkCount}>
            {item.chunk_count || 0} <Text style={styles.chunkLabel}>chunks</Text>
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={() => onRemove(item.filename)}
        disabled={isRemoving}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <MaterialCommunityIcons name="trash-can-outline" size={18} color="#EF4444" />
      </TouchableOpacity>
    </View>
  );
});

// ─── Stat Card (memoized, no animation overhead) ──────────────────────────────
const StatCard = memo(function StatCard({ icon, color, bg, value, label }) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIconWrap, { backgroundColor: bg }]}>
        <MaterialCommunityIcons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
});

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const router = useRouter();
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [adminName, setAdminName] = useState("Admin");
  const abortRef = useRef(null);

  useEffect(() => {
    checkAdminAccess();
    return () => abortRef.current?.abort(); // cancel fetch on unmount
  }, []);

 const checkAdminAccess = async () => {
    try {
      const user = getAuth().currentUser;
      if (!user) { router.replace("/screens/login"); return; }

      const name = user.displayName || (user.email ? user.email.split("@")[0] : "Admin");
      setAdminName(name);

      // getUserRole will return from cache (already fetched during login)
      const [role] = await Promise.all([
        getUserRole(user.uid),
        loadDocuments(),
      ]);

      if (role !== "admin") {
        Alert.alert("Access Denied", "You do not have admin privileges.");
        router.replace("/screens/(tabs)/home");
      }
    } catch (error) {
      if (error?.name !== "AbortError") console.error(error);
    }
  };

  const loadDocuments = useCallback(async () => {
    try {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setIsLoading(true);
      const response = await fetch(`${BASE_URL}/admin/documents/list/`, {
        signal: abortRef.current.signal,
      });
      const data = await response.json();
      if (data.success) setDocuments(data.documents || []);
    } catch (err) {
      if (err?.name !== "AbortError") Alert.alert("Error", "Could not load documents.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleAddDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      Alert.alert("Upload Document", `Upload "${file.name}"?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Upload", onPress: () => uploadDocument(file) },
      ]);
    } catch {
      Alert.alert("Error", "Could not open file picker.");
    }
  }, []);

  const uploadDocument = useCallback(async (file) => {
    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append("document", { uri: file.uri, name: file.name, type: "application/pdf" });
      const response = await fetch(`${BASE_URL}/admin/documents/add/`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (data.success) {
        // Optimistic update — show instantly, background-refresh after 2s for real status
        setDocuments((prev) => [...prev, { filename: file.name, indexed: false, chunk_count: 0 }]);
        Alert.alert("Success", `"${file.name}" uploaded. Indexing in progress.`);
        setTimeout(loadDocuments, 2000);
      } else {
        Alert.alert("Error", data.error || "Upload failed.");
      }
    } catch {
      Alert.alert("Error", "Could not connect to server.");
    } finally {
      setIsUploading(false);
    }
  }, [loadDocuments]);

  const handleRemoveDocument = useCallback((filename) => {
    Alert.alert("Remove Document", `Remove "${filename}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => confirmRemoveDocument(filename) },
    ]);
  }, []);

  const confirmRemoveDocument = useCallback(async (filename) => {
    // Optimistic remove — instant UI feedback
    setDocuments((prev) => prev.filter((d) => d.filename !== filename));
    try {
      setIsRemoving(true);
      const response = await fetch(`${BASE_URL}/admin/documents/remove/`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      const data = await response.json();
      if (!data.success) {
        loadDocuments(); // revert if server rejected
        Alert.alert("Error", data.error || "Failed to remove.");
      }
    } catch {
      loadDocuments(); // revert on network error
      Alert.alert("Error", "Could not connect to server.");
    } finally {
      setIsRemoving(false);
    }
  }, [loadDocuments]);

  const handleLogout = useCallback(() => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => { await signOut(auth); router.replace("/screens/login"); },
      },
    ]);
  }, []);

  // Stable references — prevent FlatList from re-rendering on every parent render
  const keyExtractor = useCallback((item) => item.filename, []);
  const renderItem = useCallback(
    ({ item }) => <DocCard item={item} onRemove={handleRemoveDocument} isRemoving={isRemoving} />,
    [handleRemoveDocument, isRemoving]
  );

  const indexedCount = documents.filter((d) => d.indexed).length;
  const totalChunks = documents.reduce((s, d) => s + (d.chunk_count || 0), 0);

  // ── Loading Screen ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
        <View style={styles.loadingContainer}>
          <View style={styles.loadingCard}>
            <View style={styles.loadingIconRing}>
              <MaterialCommunityIcons name="shield-account" size={32} color="#3B82F6" />
            </View>
            <ActivityIndicator size="large" color="#3B82F6" style={{ marginTop: 20 }} />
            <Text style={styles.loadingTitle}>Admin Panel</Text>
            <Text style={styles.loadingSubtitle}>Loading…</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIconWrap}>
            <MaterialCommunityIcons name="shield-account" size={22} color="#3B82F6" />
          </View>
          <View>
            <Text style={styles.headerTitle}>{adminName}</Text>
            <Text style={styles.headerSub}>Admin · Document Management</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={loadDocuments}
            activeOpacity={0.75}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="refresh" size={19} color="#94A3B8" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={handleLogout}
            activeOpacity={0.75}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="logout-variant" size={19} color="#94A3B8" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        removeClippedSubviews
      >
        {/* Stats */}
        <View style={styles.statsRow}>
          <StatCard icon="file-document-multiple-outline" color="#3B82F6" bg="#EFF6FF" value={documents.length} label="Total" />
          <StatCard icon="check-decagram-outline" color="#10B981" bg="#ECFDF5" value={indexedCount} label="Indexed" />
          <StatCard icon="layers-triple-outline" color="#8B5CF6" bg="#F5F3FF" value={totalChunks} label="Chunks" />
        </View>

        {/* Section header */}
        <View style={styles.sectionBar}>
          <View>
            <Text style={styles.sectionTitle}>Documents</Text>
            <Text style={styles.sectionSub}>
              {documents.length} file{documents.length !== 1 ? "s" : ""} in knowledge base
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.uploadBtn, isUploading && styles.uploadBtnDisabled]}
            onPress={handleAddDocument}
            disabled={isUploading}
            activeOpacity={0.8}
          >
            {isUploading
              ? <ActivityIndicator size="small" color="#FFF" />
              : <MaterialCommunityIcons name="upload-outline" size={17} color="#FFF" />
            }
            <Text style={styles.uploadBtnText}>{isUploading ? "Uploading…" : "Upload"}</Text>
          </TouchableOpacity>
        </View>

        {/* Upload progress banner */}
        {isUploading && (
          <View style={styles.uploadBanner}>
            <ActivityIndicator size="small" color="#3B82F6" />
            <Text style={styles.uploadBannerText}>Uploading & indexing document…</Text>
          </View>
        )}

        {/* Document list */}
        {documents.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <MaterialCommunityIcons name="folder-open-outline" size={40} color="#94A3B8" />
            </View>
            <Text style={styles.emptyTitle}>No Documents Yet</Text>
            <Text style={styles.emptySubtitle}>Upload PDF files to build your knowledge base</Text>
            <TouchableOpacity style={styles.emptyUploadBtn} onPress={handleAddDocument}>
              <MaterialCommunityIcons name="plus" size={16} color="#3B82F6" />
              <Text style={styles.emptyUploadText}>Add First Document</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={documents}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            scrollEnabled={false}       // parent ScrollView handles scroll
            removeClippedSubviews       // unmounts off-screen items
            initialNumToRender={8}      // renders only first 8 on mount
            maxToRenderPerBatch={5}     // renders 5 at a time while scrolling
            windowSize={5}              // keeps 5 screens worth in memory
          />
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0F172A" },

  // Loading
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0F172A", padding: 30 },
  loadingCard: { width: "100%", maxWidth: 280, backgroundColor: "#1E293B", borderRadius: 24, padding: 36, alignItems: "center", borderWidth: 1, borderColor: "#334155" },
  loadingIconRing: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#1D3461", justifyContent: "center", alignItems: "center", borderWidth: 2, borderColor: "#3B82F6" },
  loadingTitle: { fontSize: 20, fontWeight: "700", color: "#F1F5F9", marginTop: 16, letterSpacing: 0.3 },
  loadingSubtitle: { fontSize: 13, color: "#64748B", marginTop: 4 },

  // Header
  header: { backgroundColor: "#0F172A", flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: "#1E293B" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerIconWrap: { width: 42, height: 42, borderRadius: 13, backgroundColor: "#1D3461", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#2563EB33" },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#F1F5F9", letterSpacing: 0.2 },
  headerSub: { fontSize: 11, color: "#64748B", marginTop: 1 },
  headerActions: { flexDirection: "row", gap: 8 },
  headerBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#1E293B", borderWidth: 1, borderColor: "#334155", justifyContent: "center", alignItems: "center" },

  // Scroll
  scroll: { flex: 1, backgroundColor: "#F8FAFC" },
  scrollContent: { paddingBottom: 20 },

  // Stats
  statsRow: { flexDirection: "row", paddingHorizontal: 16, paddingTop: 18, gap: 10 },
  statCard: { flex: 1, backgroundColor: "#FFF", borderRadius: 16, paddingVertical: 16, paddingHorizontal: 10, alignItems: "center", elevation: 2, borderWidth: 1, borderColor: "#F1F5F9" },
  statIconWrap: { width: 38, height: 38, borderRadius: 11, justifyContent: "center", alignItems: "center" },
  statValue: { fontSize: 22, fontWeight: "800", color: "#0F172A", marginTop: 8, letterSpacing: -0.5 },
  statLabel: { fontSize: 11, color: "#94A3B8", marginTop: 2, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.5 },

  // Section bar
  sectionBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, marginTop: 24, marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: "#0F172A" },
  sectionSub: { fontSize: 12, color: "#94A3B8", marginTop: 2 },
  uploadBtn: { flexDirection: "row", alignItems: "center", backgroundColor: "#2563EB", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, gap: 5, elevation: 3 },
  uploadBtnDisabled: { opacity: 0.6 },
  uploadBtnText: { color: "#FFF", fontWeight: "600", fontSize: 13 },

  // Upload banner
  uploadBanner: { flexDirection: "row", alignItems: "center", backgroundColor: "#EFF6FF", marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, gap: 10, borderWidth: 1, borderColor: "#BFDBFE" },
  uploadBannerText: { fontSize: 13, color: "#1D4ED8", fontWeight: "500" },

  // Doc card
  docCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFF", marginHorizontal: 16, marginBottom: 9, borderRadius: 16, overflow: "hidden", elevation: 2, borderWidth: 1, borderColor: "#F1F5F9" },
  docStripe: { width: 4, alignSelf: "stretch" },
  docIconWrap: { width: 46, height: 46, borderRadius: 13, justifyContent: "center", alignItems: "center", marginLeft: 12 },
  docInfo: { flex: 1, marginLeft: 12, paddingVertical: 14, paddingRight: 6 },
  docName: { fontSize: 13, fontWeight: "600", color: "#1E293B", letterSpacing: 0.1 },
  docTagRow: { flexDirection: "row", alignItems: "center", marginTop: 6, gap: 8 },
  statusPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, gap: 4 },
  pillIndexed: { backgroundColor: "#ECFDF5" },
  pillPending: { backgroundColor: "#FFFBEB" },
  pillDot: { width: 5, height: 5, borderRadius: 3 },
  pillText: { fontSize: 11, fontWeight: "600", letterSpacing: 0.2 },
  chunkCount: { fontSize: 11, color: "#334155", fontWeight: "600" },
  chunkLabel: { color: "#94A3B8", fontWeight: "400" },
  deleteBtn: { width: 38, height: 38, borderRadius: 11, backgroundColor: "#FEF2F2", justifyContent: "center", alignItems: "center", marginRight: 12, borderWidth: 1, borderColor: "#FEE2E2" },

  // Empty state
  emptyState: { alignItems: "center", paddingVertical: 50, paddingHorizontal: 30 },
  emptyIconWrap: { width: 80, height: 80, borderRadius: 24, backgroundColor: "#F1F5F9", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#E2E8F0" },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: "#334155", marginTop: 18 },
  emptySubtitle: { fontSize: 13, color: "#94A3B8", marginTop: 6, textAlign: "center", lineHeight: 19 },
  emptyUploadBtn: { flexDirection: "row", alignItems: "center", marginTop: 22, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: "#3B82F6", gap: 6 },
  emptyUploadText: { color: "#3B82F6", fontWeight: "600", fontSize: 13 },
});