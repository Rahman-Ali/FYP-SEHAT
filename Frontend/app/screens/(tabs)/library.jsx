//D:\project\Frontend\app\screens\(tabs)\library.jsx
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  item,
  View,
} from "react-native";
import { Asset } from "expo-asset";
import { WebView } from "react-native-webview";
import { useEffect, useState } from "react";
import { booksData } from "../../books";

// ─────────────────────────────────────────────
// Filter Chip
// ─────────────────────────────────────────────
const FilterChip = ({ label, isActive, onPress }) => (
  <TouchableOpacity
    style={[
      styles.filterChip,
      isActive && { backgroundColor: "#0D47A1", borderColor: "#0D47A1" },
    ]}
    onPress={onPress}
  >
    <Text style={[styles.filterText, isActive && { color: "#FFF" }]}>
      {label}
    </Text>
  </TouchableOpacity>
);

// ─────────────────────────────────────────────
// PDF Viewer Modal
// ─────────────────────────────────────────────
const pdfCache = {}; // 👈 global memory cache

const PDFViewerModal = ({ visible, pdfSource, title, color, onClose }) => {
  const [uri, setUri] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        // ✅ STEP 1: CHECK MEMORY CACHE FIRST
        if (pdfCache[pdfSource]) {
          setUri(pdfCache[pdfSource]);
          return;
        }

        // ✅ STEP 2: LOAD ONLY IF NOT CACHED
        const asset = Asset.fromModule(pdfSource);
        await asset.downloadAsync();

        const finalUri = asset.uri;

        // ✅ STEP 3: SAVE IN CACHE
        pdfCache[pdfSource] = finalUri;

        setUri(finalUri);
      } catch (e) {
        console.log(e);
      }
    };

    if (pdfSource) load();
  }, [pdfSource]);

  return (
    <Modal visible={visible} animationType="slide">
      <SafeAreaView style={{ flex: 1 }}>

        <LinearGradient colors={[color, color + "CC"]} style={styles.pdfHeader}>
          <TouchableOpacity onPress={onClose}>
            <MaterialCommunityIcons name="arrow-left" size={24} color="#FFF" />
          </TouchableOpacity>

          <Text style={styles.pdfTitle}>{title}</Text>
          <View style={{ width: 40 }} />
        </LinearGradient>

        {uri ? (
          <WebView source={{ uri }} style={{ flex: 1 }} />
        ) : (
          <ActivityIndicator size="large" color={color} />
        )}

      </SafeAreaView>
    </Modal>
  );
};
// ─────────────────────────────────────────────
// Disease Card
// ─────────────────────────────────────────────
const DiseaseCard = ({ item, expanded, toggleExpand, isUrdu, onViewPDF }) => {
  const t = (en, ur) => (isUrdu ? ur : en);

  return (
    <View style={styles.card}>
      {/* Card Header */}
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={toggleExpand}
        activeOpacity={0.8}
      >
        <View style={styles.headerLeft}>
          <View
            style={[styles.iconBox, { backgroundColor: `${item.color}20` }]}
          >
            <MaterialCommunityIcons
              name="medical-bag"
              size={24}
              color={item.color}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{t(item.name, item.nameUrdu)}</Text>
            <Text style={[styles.cardType, { color: item.color }]}>
              {item.type}
            </Text>
          </View>
        </View>
        <MaterialCommunityIcons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={24}
          color="#757575"
        />
      </TouchableOpacity>

      {/* Expanded Body */}
      {expanded && (
        <View style={styles.cardBody}>
          <Text style={styles.description}>
            {t(item.description, item.descriptionUrdu)}
          </Text>

          {/* Causes */}
          <Section
            title={t("Causes", "Wajuhaat")}
            items={t(item.causes, item.causesUrdu)}
            icon="alert-circle-outline"
            iconColor="#757575"
            headerColor={item.color}
          />

          {/* Symptoms */}
          <Section
            title={t("Symptoms", "Alamaat")}
            items={t(item.symptoms, item.symptomsUrdu)}
            icon="thermometer"
            iconColor="#757575"
            headerColor={item.color}
          />

          {/* Remedies */}
          <Section
            title={t("Home Remedies", "Ghar ka Ilaj")}
            items={t(item.remedies, item.remediesUrdu)}
            icon="check-circle-outline"
            iconColor="#4CAF50"
            headerColor={item.color}
          />

          {/* Warning */}
          <View style={[styles.warningBox, { borderColor: item.color }]}>
            <MaterialCommunityIcons
              name="alert"
              size={20}
              color={item.color}
              style={{ marginRight: 8 }}
            />
            <Text style={[styles.warningText, { color: item.color }]}>
              {t(item.warning, item.warningUrdu)}
            </Text>
          </View>

          {/* View PDF Button */}
          <TouchableOpacity
            style={[styles.pdfButton, { backgroundColor: item.color }]}
            onPress={onViewPDF}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons
              name="file-pdf-box"
              size={20}
              color="#FFF"
              style={{ marginRight: 8 }}
            />
            <Text style={styles.pdfButtonText}>
              {t("Download PDF", "PDF Download Karo")}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

// ─────────────────────────────────────────────
// Reusable Section Component
// ─────────────────────────────────────────────
const Section = ({ title, items, icon, iconColor, headerColor }) => (
  <View style={styles.section}>
    <Text style={[styles.sectionHeader, { color: headerColor }]}>{title}</Text>
    {items.map((text, index) => (
      <View key={index} style={styles.listItem}>
        <MaterialCommunityIcons name={icon} size={16} color={iconColor} />
        <Text style={styles.listText}>{text}</Text>
      </View>
    ))}
  </View>
);

// ─────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────
export default function LibraryScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [expandedId, setExpandedId] = useState(null);
  const [isUrdu, setIsUrdu] = useState(false);
  const [pdfModal, setPdfModal] = useState({ visible: false, item: null });

  const filters = [
    "All",
    "Viral",
    "Bacterial",
    "Infection",
    "Allergy",
    "Parasitic",
  ];

  const filteredDiseases = booksData.filter((item) => {
    const name = isUrdu ? item.nameUrdu : item.name;
    const matchesSearch = name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesFilter = activeFilter === "All" || item.type === activeFilter;
    return matchesSearch && matchesFilter;
  });

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const openPDF = (item) => {
    setPdfModal({ visible: true, item });
  };

  const closePDF = () => {
    setPdfModal({ visible: false, item: null });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <LinearGradient colors={["#0D47A1", "#1976D2"]} style={styles.header}>
        <View style={styles.headerContent}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>
              {isUrdu ? "Library" : "Library"}
            </Text>
            <Text style={styles.headerSubtitle}>
              {isUrdu
                ? "Aam beeimariyan aur ilaj"
                : "Common diseases & remedies"}
            </Text>
          </View>

          {/* Roman Urdu Toggle */}
          <TouchableOpacity
            style={[styles.langToggle, isUrdu && styles.langToggleActive]}
            onPress={() => setIsUrdu(!isUrdu)}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons
              name="translate"
              size={16}
              color={isUrdu ? "#0D47A1" : "#FFF"}
              style={{ marginRight: 5 }}
            />
            <Text
              style={[
                styles.langToggleText,
                isUrdu && styles.langToggleTextActive,
              ]}
            >
              {isUrdu ? "Roman Urdu ✓" : "Roman Urdu"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <MaterialCommunityIcons name="magnify" size={20} color="#757575" />
          <TextInput
            style={styles.searchInput}
            placeholder={
              isUrdu ? "Beemari talaash karo..." : "Search diseases..."
            }
            placeholderTextColor="#9E9E9E"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <MaterialCommunityIcons
                name="close-circle"
                size={20}
                color="#757575"
              />
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>

      {/* Filters */}
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {filters.map((filter) => (
            <FilterChip
              key={filter}
              label={filter}
              isActive={activeFilter === filter}
              onPress={() => setActiveFilter(filter)}
            />
          ))}
        </ScrollView>
      </View>

      {/* Cards */}
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {filteredDiseases.length > 0 ? (
          filteredDiseases.map((item) => (
            <DiseaseCard
              key={item.id}
              item={item}
              expanded={expandedId === item.id}
              toggleExpand={() => toggleExpand(item.id)}
              isUrdu={isUrdu}
              onViewPDF={() => openPDF(item)}
            />
          ))
        ) : (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons
              name="file-search-outline"
              size={60}
              color="#E0E0E0"
            />
            <Text style={styles.emptyText}>
              {isUrdu ? "Koi beemari nahi mili" : "No diseases found"}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* PDF Viewer Modal */}
      {pdfModal.item && (
        <PDFViewerModal
          visible={pdfModal.visible}
          pdfSource={pdfModal.item.pdf}
          title={isUrdu ? pdfModal.item.nameUrdu : pdfModal.item.name}
          color={pdfModal.item.color}
          onClose={closePDF}
        />
      )}
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F5F7FA",
  },

  // ── Header ──
  header: {
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight + 20 : 60,
    paddingBottom: 25,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#FFF",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.9)",
    marginTop: 4,
  },

  // ── Language Toggle ──
  langToggle: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.8)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 10,
  },
  langToggleActive: {
    backgroundColor: "#FFF",
    borderColor: "#FFF",
  },
  langToggleText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFF",
  },
  langToggleTextActive: {
    color: "#0D47A1",
  },

  // ── Search ──
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
    color: "#333",
  },

  // ── Filters ──
  filterContainer: {
    marginTop: 20,
    marginBottom: 10,
    paddingLeft: 20,
    height: 40,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E0E0E0",
    marginRight: 10,
    height: 36,
    justifyContent: "center",
  },
  filterText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#757575",
  },

  // ── List ──
  container: { flex: 1 },
  contentContainer: { paddingHorizontal: 20, paddingBottom: 40 },

  // ── Card ──
  card: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    marginBottom: 15,
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    flexWrap: "wrap",
  },
  cardType: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
  },

  // ── Card Body ──
  cardBody: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: "#F5F5F5",
  },
  description: {
    fontSize: 14,
    color: "#616161",
    lineHeight: 22,
    marginTop: 15,
    marginBottom: 20,
  },
  section: { marginBottom: 20 },
  sectionHeader: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 10,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  listText: {
    fontSize: 14,
    color: "#424242",
    marginLeft: 10,
    flex: 1,
    lineHeight: 20,
  },

  // ── Warning ──
  warningBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF3E0",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 5,
  },
  warningText: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },

  // ── PDF Button ──
  pdfButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
  },
  pdfButtonText: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 15,
  },

  // ── Empty State ──
  emptyState: {
    alignItems: "center",
    marginTop: 60,
  },
  emptyText: {
    marginTop: 10,
    fontSize: 16,
    color: "#9E9E9E",
  },

  // ── PDF Modal ──
  pdfSafeArea: {
    flex: 1,
    backgroundColor: "#FFF",
  },
  pdfHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight + 10 : 16,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  pdfCloseBtn: {
    padding: 4,
    marginRight: 12,
  },
  pdfTitle: {
    flex: 1,
    color: "#FFF",
    fontSize: 17,
    fontWeight: "700",
  },
  pdfLoading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFF",
    zIndex: 10,
    marginTop: 80,
  },
  pdfLoadingText: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: "600",
  },
  pdfFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  pdfFallbackTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginTop: 12,
    marginBottom: 16,
    textAlign: "center",
  },
  pdfFallbackText: {
    fontSize: 14,
    color: "#616161",
    textAlign: "center",
    marginBottom: 8,
    lineHeight: 22,
  },
  codeBlock: {
    backgroundColor: "#F1F5F9",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    width: "100%",
  },
  codeText: {
    fontSize: 12,
    color: "#0D47A1",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    lineHeight: 20,
  },
});