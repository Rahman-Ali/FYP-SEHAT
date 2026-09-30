// In-app reader for Library reference books: the server's pdf.js viewer in a WebView,
// opened at a page, with page jump, loading and error states. Never leaves the app's server.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { fetch as expoFetch } from "expo/fetch";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import apiService, { SERVER_ORIGIN } from "../../app/services/api";

// Non-browser user agent: proxies like ngrok then serve the page directly (no warning page)
const READER_USER_AGENT = "SEHATApp/1.0 (in-app reader)";

const errorMessage = (status, offline) => {
  if (offline) return "You're offline. Reference books open when you're back online.";
  if (status === 404) return "This source is no longer available.";
  if (status === 403) return "This link has expired. Please try again.";
  return "Couldn't open this book. Please try again.";
};

export default function ReferenceBookViewer({ visible, doc, initialPage = 1, onClose }) {
  const webRef = useRef(null);
  const [viewerUrl, setViewerUrl] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [webLoading, setWebLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pageInput, setPageInput] = useState("");
  const totalPages = doc?.pages || null;

  const clampPage = useCallback(
    (p) => {
      const n = Math.max(1, Math.floor(Number(p) || 1));
      return totalPages ? Math.min(n, totalPages) : n;
    },
    [totalPages]
  );

  const prepare = useCallback(async () => {
    if (!doc?.doc_id) return;
    setPreparing(true);
    setError(null);
    setViewerUrl(null);
    try {
      const { viewerUrl: url, fileUrl } = await apiService.getLibraryLink(doc.doc_id, "read");
      // Check the book is still there before showing the viewer (clear message instead of a blank page)
      const head = await expoFetch(fileUrl, {
        method: "HEAD",
        headers: { "ngrok-skip-browser-warning": "true" },
      });
      if (!head.ok) throw Object.assign(new Error("book unavailable"), { status: head.status });
      const page = clampPage(initialPage);
      setPageInput(String(page));
      setViewerUrl(`${url}#page=${page}`);
    } catch (e) {
      const status = e?.status || e?.response?.status;
      setError(errorMessage(status, !status && !e?.response));
    } finally {
      setPreparing(false);
    }
  }, [doc?.doc_id, initialPage, clampPage]);

  useEffect(() => {
    if (visible) prepare();
    else {
      setViewerUrl(null);
      setError(null);
    }
  }, [visible, prepare]);

  const jumpToPage = () => {
    Keyboard.dismiss();
    const page = clampPage(pageInput);
    setPageInput(String(page));
    webRef.current?.injectJavaScript(
      `try { window.PDFViewerApplication.page = ${page}; } catch (e) {} true;`
    );
  };

  // Only the app's own server may load inside the reader (no external sites)
  const allowNavigation = (request) => {
    const url = request?.url || "";
    return url.startsWith(SERVER_ORIGIN) || url.startsWith("about:") || url.startsWith("blob:") || url.startsWith("data:");
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityLabel="Close book">
            <MaterialCommunityIcons name="close" size={24} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>{doc?.title || "Reference book"}</Text>
        </View>

        <View style={styles.pageBar}>
          <Text style={styles.pageLabel}>Page</Text>
          <TextInput
            style={styles.pageInput}
            value={pageInput}
            onChangeText={(t) => setPageInput(t.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            returnKeyType="go"
            onSubmitEditing={jumpToPage}
            editable={!!viewerUrl}
            maxLength={5}
            accessibilityLabel="Page number"
          />
          {totalPages ? <Text style={styles.pageLabel}>of {totalPages}</Text> : null}
          <TouchableOpacity
            style={[styles.goBtn, !viewerUrl && styles.goBtnDisabled]}
            onPress={jumpToPage}
            disabled={!viewerUrl}
          >
            <Text style={styles.goText}>Go</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          {error ? (
            <View style={styles.center}>
              <MaterialCommunityIcons name="book-remove-outline" size={48} color="#94A3B8" />
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={prepare}>
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : viewerUrl ? (
            <>
              <WebView
                ref={webRef}
                source={{ uri: viewerUrl }}
                userAgent={READER_USER_AGENT}
                originWhitelist={["http://*", "https://*"]}
                onShouldStartLoadWithRequest={allowNavigation}
                setSupportMultipleWindows={false}
                javaScriptEnabled
                domStorageEnabled
                allowFileAccess={false}
                onLoadStart={() => setWebLoading(true)}
                onLoadEnd={() => setWebLoading(false)}
                onError={() => setError(errorMessage(null, true))}
                onHttpError={(e) => setError(errorMessage(e.nativeEvent.statusCode, false))}
                style={styles.web}
              />
              {webLoading && (
                <View style={styles.overlay} pointerEvents="none">
                  <ActivityIndicator size="large" color="#0D47A1" />
                  <Text style={styles.loadingText}>Opening book...</Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.center}>
              <ActivityIndicator size="large" color="#0D47A1" />
              <Text style={styles.loadingText}>{preparing ? "Preparing book..." : ""}</Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0D47A1" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 8, gap: 4 },
  iconBtn: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  title: { flex: 1, color: "#FFF", fontSize: 16, fontWeight: "700" },
  pageBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#F1F5F9", paddingHorizontal: 12, paddingVertical: 8,
  },
  pageLabel: { fontSize: 14, color: "#334155", fontWeight: "600" },
  pageInput: {
    minWidth: 64, height: 40, borderRadius: 8, borderWidth: 1, borderColor: "#CBD5E1",
    backgroundColor: "#FFF", paddingHorizontal: 10, fontSize: 15, color: "#0F172A", textAlign: "center",
  },
  goBtn: { minWidth: 56, height: 40, borderRadius: 8, backgroundColor: "#0D47A1", justifyContent: "center", alignItems: "center" },
  goBtnDisabled: { backgroundColor: "#94A3B8" },
  goText: { color: "#FFF", fontWeight: "700", fontSize: 15 },
  body: { flex: 1, backgroundColor: "#FFF" },
  web: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(255,255,255,0.85)" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 12 },
  loadingText: { color: "#475569", fontSize: 14, marginTop: 8 },
  errorText: { color: "#334155", fontSize: 15, textAlign: "center", lineHeight: 22 },
  retryBtn: { minHeight: 44, paddingHorizontal: 22, borderRadius: 22, backgroundColor: "#E3F2FD", justifyContent: "center" },
  retryText: { color: "#0D47A1", fontWeight: "700" },
});
