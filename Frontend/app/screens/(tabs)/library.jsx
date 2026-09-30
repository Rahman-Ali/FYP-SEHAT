//D:\project\Frontend\app\screens\(tabs)\library.jsx
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  Alert,
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
import * as LegacyFileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { WebView } from "react-native-webview";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { booksData } from "../../books";
import apiService from "../../services/api";
import ReferenceBookViewer from "../../../components/library/ReferenceBookViewer";
import { entryMatchesDisease, findDocument, formatSize } from "../../../components/library/libraryUtils";

const OFFLINE_NOTE = "You're offline. Showing your saved list; reading and downloading need internet.";

const shareOptions = (title) => ({ mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: title });

// One reference book (from the documents API)
const BookCard = ({ doc, offline, highlightPage, onRead, onDownload, downloadProgress }) => {
  const busy = downloadProgress !== undefined && downloadProgress !== null;
  return (
    <View style={[styles.bookCard, highlightPage && styles.bookCardHighlight]}>
      {highlightPage ? (
        <View style={styles.citedRow}>
          <MaterialCommunityIcons name="format-quote-open" size={16} color="#0D47A1" />
          <Text style={styles.citedText}>Cited in chat</Text>
        </View>
      ) : null}
      <View style={styles.bookTop}>
        <MaterialCommunityIcons name="book-open-page-variant-outline" size={22} color="#0D47A1" />
        <View style={{ flex: 1 }}>
          <Text style={styles.bookTitle}>{doc.title}</Text>
          <Text style={styles.bookMeta}>
            {doc.pages ? `${doc.pages} pages` : ""}
            {doc.pages && doc.size_mb ? "  ·  " : ""}
            {formatSize(doc.size_mb)}
          </Text>
        </View>
      </View>
      {highlightPage ? (
        <TouchableOpacity
          style={[styles.openAtBtn, offline && styles.bookBtnDisabled]}
          onPress={() => onRead(doc, highlightPage)}
          disabled={offline}
        >
          <MaterialCommunityIcons name="book-arrow-right-outline" size={18} color="#FFF" />
          <Text style={styles.openAtText}>Open at page {highlightPage}</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.bookActions}>
        <TouchableOpacity
          style={[styles.bookBtn, offline && styles.bookBtnDisabled]}
          onPress={() => onRead(doc, 1)}
          disabled={offline}
          accessibilityLabel={`Read ${doc.title}`}
        >
          <MaterialCommunityIcons name="book-open-variant" size={18} color={offline ? "#94A3B8" : "#0D47A1"} />
          <Text style={[styles.bookBtnText, offline && styles.bookBtnTextDisabled]}>Read</Text>
        </TouchableOpacity>
        {doc.downloadable ? (
          <TouchableOpacity
            style={[styles.bookBtn, (offline || busy) && styles.bookBtnDisabled]}
            onPress={() => onDownload(doc)}
            disabled={offline || busy}
            accessibilityLabel={`Download ${doc.title}`}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#0D47A1" />
            ) : (
              <MaterialCommunityIcons name="download" size={18} color={offline ? "#94A3B8" : "#0D47A1"} />
            )}
            <Text style={[styles.bookBtnText, (offline || busy) && styles.bookBtnTextDisabled]}>
              {busy ? `Downloading ${Math.round(downloadProgress * 100)}%` : "Download"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

// "Reference books" block: books for one disease, or a notice when there are none / offline
const ReferenceBooks = ({ title, books, refState, highlight, onRead, onDownload, download }) => (
  <View style={styles.refSection}>
    <Text style={styles.refHeader}>{title}</Text>
    {refState.offline && refState.library ? <Text style={styles.refNote}>{OFFLINE_NOTE}</Text> : null}
    {books.length > 0 ? (
      books.map((doc) => (
        <BookCard
          key={doc.doc_id}
          doc={doc}
          offline={refState.offline}
          highlightPage={highlight?.docId === doc.doc_id ? highlight.page : null}
          onRead={onRead}
          onDownload={onDownload}
          downloadProgress={download?.docId === doc.doc_id ? download.progress : null}
        />
      ))
    ) : refState.loading ? (
      <ActivityIndicator size="small" color="#0D47A1" style={{ marginVertical: 8 }} />
    ) : (
      <Text style={styles.refEmpty}>
        {refState.library
          ? "No reference books for this disease yet."
          : "Reference books can't be loaded right now. Connect to the internet and open the Library again."}
      </Text>
    )}
  </View>
);

// Filter Chip
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

// PDF Viewer Modal
const pdfCache = {}; // global memory cache

const PDFViewerModal = ({ visible, pdfSource, title, color, onClose }) => {
  const [uri, setUri] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        // 1. Check memory cache first
        if (pdfCache[pdfSource]) {
          setUri(pdfCache[pdfSource]);
          return;
        }

        // 2. Load only if not cached
        const asset = Asset.fromModule(pdfSource);
        await asset.downloadAsync();

        const finalUri = asset.uri;

        // 3. Save in cache
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
// Disease Card
const DiseaseCard = ({ item, expanded, toggleExpand, isUrdu, onViewPDF, children }) => {
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

          {children}
        </View>
      )}
    </View>
  );
};

// Reusable Section Component
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

// Main Screen
export default function LibraryScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [expandedId, setExpandedId] = useState(null);
  const [isUrdu, setIsUrdu] = useState(false);
  const [pdfModal, setPdfModal] = useState({ visible: false, item: null });
  const listRef = useRef(null);
  const cardY = useRef({});
  const pendingScrollId = useRef(null);

  // Reference books from the server (cached copy when offline)
  const [refState, setRefState] = useState({ library: null, offline: false, loading: true });
  const [highlight, setHighlight] = useState(null); // { docId, page } from a chat citation
  const [reader, setReader] = useState(null); // { doc, page }
  const [download, setDownload] = useState(null); // { docId, progress }
  const moreSectionY = useRef(null);
  const handledCitation = useRef(null);

  const loadReferenceBooks = useCallback(async () => {
    setRefState((prev) => ({ ...prev, loading: true }));
    try {
      const { library, offline } = await apiService.getLibraryDocuments();
      setRefState({ library, offline, loading: false });
    } catch {
      setRefState((prev) => ({ library: prev.library, offline: true, loading: false }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadReferenceBooks();
    }, [loadReferenceBooks])
  );

  const diseaseGroups = refState.library?.diseases || [];
  const booksForEntry = (entry) =>
    diseaseGroups.filter((g) => entryMatchesDisease(entry.name, g.disease)).flatMap((g) => g.documents || []);
  // Diseases in the index with no offline Library entry (e.g. newly added by admin, or "General")
  const unmatchedGroups = diseaseGroups.filter(
    (g) => !booksData.some((entry) => entryMatchesDisease(entry.name, g.disease))
  );

  const openReader = (doc, page) => {
    if (refState.offline) {
      Alert.alert("You're offline", "Reference books open when you're back online.");
      return;
    }
    setReader({ doc, page: page || 1 });
  };

  const handleDownload = async (doc) => {
    if (download) return;
    setDownload({ docId: doc.doc_id, progress: 0 });
    try {
      const uri = await apiService.downloadLibraryBook(doc, (progress) =>
        setDownload({ docId: doc.doc_id, progress })
      );
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, shareOptions(doc.title));
      } else {
        Alert.alert("Downloaded", "The book was saved in the app's storage.");
      }
    } catch (e) {
      const status = e?.status || e?.response?.status;
      Alert.alert(
        "Download failed",
        status === 404
          ? "This source is no longer available."
          : status === 403
            ? "This book can be read in the app but not downloaded."
            : "Couldn't download the book. Check your connection and try again."
      );
    } finally {
      setDownload(null);
    }
  };

  // Opened from a chat citation with { doc | title (older messages), page, open, citeNonce }
  const {
    diseaseId,
    nonce,
    doc: citedDocId,
    title: citedTitle,
    page: citedPage,
    open: openCited,
    citeNonce,
  } = useLocalSearchParams();

  useEffect(() => {
    if (!citeNonce || (!citedDocId && !citedTitle) || handledCitation.current === citeNonce) return;
    if (refState.loading) return; // wait for the fresh list (so removed books are detected)
    handledCitation.current = citeNonce;

    const found = findDocument(refState.library, {
      docId: citedDocId ? String(citedDocId) : null,
      title: citedDocId ? null : String(citedTitle),
    });
    if (!found) {
      Alert.alert(
        "Source unavailable",
        refState.library
          ? "This source is no longer available."
          : "You're offline. Connect to the internet to open this source."
      );
      return;
    }
    const page = Math.max(1, parseInt(citedPage, 10) || 1);
    setSearchQuery("");
    setActiveFilter("All");
    setHighlight({ docId: found.doc_id, page });

    const entry = booksData.find((e) => entryMatchesDisease(e.name, found.disease));
    if (entry) {
      setExpandedId(entry.id);
      pendingScrollId.current = entry.id;
      if (cardY.current[entry.id] !== undefined) {
        setTimeout(() => listRef.current?.scrollTo({ y: Math.max(cardY.current[entry.id] - 8, 0), animated: true }), 50);
        pendingScrollId.current = null;
      }
    } else if (moreSectionY.current !== null) {
      setTimeout(() => listRef.current?.scrollTo({ y: Math.max(moreSectionY.current - 8, 0), animated: true }), 50);
    }
    if (openCited === "1") openReader(found, page);
  }, [citeNonce, refState.loading, refState.library]);

  // Opened from Home with { diseaseId, nonce }: show that disease expanded
  useEffect(() => {
    if (!diseaseId) return;
    const id = Number(diseaseId);
    setSearchQuery("");
    setActiveFilter("All");
    setExpandedId(id);
    pendingScrollId.current = id;
    if (cardY.current[id] !== undefined) {
      listRef.current?.scrollTo({ y: Math.max(cardY.current[id] - 8, 0), animated: true });
      pendingScrollId.current = null;
    }
  }, [diseaseId, nonce]);

  const onCardLayout = (id, y) => {
    cardY.current[id] = y;
    if (pendingScrollId.current === id) {
      pendingScrollId.current = null;
      setTimeout(() => listRef.current?.scrollTo({ y: Math.max(y - 8, 0), animated: true }), 50);
    }
  };

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

  const openPDF = async (item) => {
    if (Platform.OS !== "android") {
      setPdfModal({ visible: true, item });
      return;
    }
    // Android WebView cannot display PDF files: save or open the bundled copy (works offline)
    try {
      const asset = Asset.fromModule(item.pdf);
      await asset.downloadAsync();
      const name = String(item.name).replace(/[^A-Za-z0-9 ._()-]+/g, "").trim() || "book";
      const target = `${LegacyFileSystem.cacheDirectory}${name}.pdf`;
      await LegacyFileSystem.deleteAsync(target, { idempotent: true });
      await LegacyFileSystem.copyAsync({ from: asset.localUri || asset.uri, to: target });
      if (!(await Sharing.isAvailableAsync())) throw new Error("sharing unavailable");
      await Sharing.shareAsync(target, shareOptions(item.name));
    } catch (e) {
      console.log("Bundled PDF error:", e?.message || e);
      Alert.alert("PDF", "Couldn't open this PDF on this device.");
    }
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
        ref={listRef}
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {filteredDiseases.length > 0 ? (
          filteredDiseases.map((item) => (
            <View key={item.id} onLayout={(e) => onCardLayout(item.id, e.nativeEvent.layout.y)}>
              <DiseaseCard
                item={item}
                expanded={expandedId === item.id}
                toggleExpand={() => toggleExpand(item.id)}
                isUrdu={isUrdu}
                onViewPDF={() => openPDF(item)}
              >
                <ReferenceBooks
                  title={isUrdu ? "Reference kitaabein" : "Reference books"}
                  books={booksForEntry(item)}
                  refState={refState}
                  highlight={highlight}
                  onRead={openReader}
                  onDownload={handleDownload}
                  download={download}
                />
              </DiseaseCard>
            </View>
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

        {/* Indexed books whose disease has no Library entry yet (e.g. newly added, or General) */}
        {unmatchedGroups.length > 0 && activeFilter === "All" && !searchQuery ? (
          <View
            style={styles.moreSection}
            onLayout={(e) => {
              moreSectionY.current = e.nativeEvent.layout.y;
            }}
          >
            <Text style={styles.moreTitle}>{isUrdu ? "Mazeed reference kitaabein" : "More reference books"}</Text>
            {unmatchedGroups.map((group) => (
              <View key={group.disease} style={styles.card}>
                <View style={styles.cardBody}>
                  <ReferenceBooks
                    title={group.label}
                    books={group.documents || []}
                    refState={refState}
                    highlight={highlight}
                    onRead={openReader}
                    onDownload={handleDownload}
                    download={download}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <ReferenceBookViewer
        visible={!!reader}
        doc={reader?.doc}
        initialPage={reader?.page || 1}
        onClose={() => setReader(null)}
      />

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

// Styles
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F5F7FA",
  },

  // Header
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

  // Language Toggle
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

  // Search
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

  // Filters
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

  // List
  container: { flex: 1 },
  contentContainer: { paddingHorizontal: 20, paddingBottom: 40 },

  // Card
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

  // Card Body
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

  // Warning
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

  // PDF Button
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

  // Reference books (from the documents API)
  refSection: {
    marginTop: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#EEF2F7",
  },
  refHeader: { fontSize: 16, fontWeight: "bold", color: "#0D47A1", marginBottom: 10 },
  refNote: {
    fontSize: 12, color: "#8A6D00", backgroundColor: "#FFF8E1",
    borderRadius: 8, padding: 8, marginBottom: 10, lineHeight: 17,
  },
  refEmpty: { fontSize: 13, color: "#757575", lineHeight: 19 },
  bookCard: {
    borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12,
    padding: 12, marginBottom: 10, backgroundColor: "#FAFCFF",
  },
  bookCardHighlight: { borderColor: "#0D47A1", borderWidth: 2, backgroundColor: "#EEF5FF" },
  citedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
  citedText: { fontSize: 12, fontWeight: "700", color: "#0D47A1" },
  bookTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bookTitle: { fontSize: 14, fontWeight: "700", color: "#1E293B", lineHeight: 20 },
  bookMeta: { fontSize: 12, color: "#64748B", marginTop: 3 },
  openAtBtn: {
    marginTop: 10, minHeight: 44, borderRadius: 10, backgroundColor: "#0D47A1",
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  openAtText: { color: "#FFF", fontWeight: "700", fontSize: 14 },
  bookActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  bookBtn: {
    flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: "#BBDEFB",
    backgroundColor: "#FFF", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  bookBtnDisabled: { borderColor: "#E2E8F0", backgroundColor: "#F1F5F9" },
  bookBtnText: { color: "#0D47A1", fontWeight: "700", fontSize: 14 },
  bookBtnTextDisabled: { color: "#94A3B8" },
  moreSection: { marginTop: 10 },
  moreTitle: { fontSize: 18, fontWeight: "bold", color: "#0D47A1", marginBottom: 10 },

  // Empty State
  emptyState: {
    alignItems: "center",
    marginTop: 60,
  },
  emptyText: {
    marginTop: 10,
    fontSize: 16,
    color: "#9E9E9E",
  },

  // PDF Modal
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