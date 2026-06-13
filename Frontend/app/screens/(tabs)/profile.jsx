//D:\project\Frontend\app\screens\(tabs)\profile.jsx
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  EmailAuthProvider,
  fetchSignInMethodsForEmail,
  reauthenticateWithCredential,
  signOut,
  updatePassword,
  updateProfile,
  verifyBeforeUpdateEmail,
} from "firebase/auth";
import { deleteField, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { auth, db } from "../../../firebase.config";

export default function ProfileScreen() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);

  // Edit state
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editConfirmPassword, setEditConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);

  const PENDING_EMAIL_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      router.replace("/screens/login");
      return;
    }

    setUser(currentUser);
    setEditEmail(currentUser.email || "");

    const userDocRef = doc(db, "users", currentUser.uid);

    // onSnapshot — realtime listener: fires instantly on any Firestore change
    const unsubscribe = onSnapshot(userDocRef, async (snap) => {
      if (!snap.exists()) return;

      const data = snap.data();
      const now = Date.now();
      const sentAt = data.pendingEmailSentAt || 0;

      // Case 1: TTL expired — silently clear pending email
      if (data.pendingEmail && (now - sentAt) > PENDING_EMAIL_TTL_MS) {
        await updateDoc(userDocRef, {
          pendingEmail: deleteField(),
          pendingEmailSentAt: deleteField(),
        });
        // onSnapshot fires again automatically with cleared data
        return;
      }

      // Case 2: pendingEmail present — check if Firebase Auth email already updated
      if (data.pendingEmail) {
        try {
          await auth.currentUser?.reload();
          const refreshed = auth.currentUser;
          if (
            refreshed?.email &&
            refreshed.email.toLowerCase() === data.pendingEmail.toLowerCase()
          ) {
            // User confirmed — update Firestore email and clear pending
            // onSnapshot will fire again, hitting Case 3 below
            await updateDoc(userDocRef, {
              email: refreshed.email,
              pendingEmail: deleteField(),
              pendingEmailSentAt: deleteField(),
            });
            return;
          }
        } catch (_) {}

        // Not confirmed yet — just update UI with current data
        setUserData(data);
        setEditName(data.fullName || "");
        setIsLoading(false);
        return;
      }

      // Case 3: No pendingEmail + Firestore email differs from original Auth email
      // This fires right after Case 2 clears pendingEmail — means email was just confirmed
      if (
        data.email &&
        data.email.toLowerCase() !== currentUser.email.toLowerCase()
      ) {
        // Sign out so user logs in fresh with new email
        await signOut(auth);
        Alert.alert(
          "Email Verified ✓",
          `Your email has been successfully changed to:

${data.email}

Please log in again with your new email.`,
          [{ text: "Login", onPress: () => router.replace("/screens/login") }]
        );
        return;
      }

      // Default: normal Firestore update (name, role, etc.)
      setUserData(data);
      setEditName(data.fullName || "");
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);


  // Basic email format check
  const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSaveProfile = async () => {
    // --- Validations ---
    if (!editName.trim()) {
      Alert.alert("Validation Error", "Name cannot be empty.");
      return;
    }

    const newEmail = editEmail.trim().toLowerCase();
    const currentEmail = user.email.toLowerCase();
    const emailChanged = newEmail !== currentEmail;

    if (emailChanged && !isValidEmail(newEmail)) {
      Alert.alert("Invalid Email", "Please enter a valid email address (e.g. user@example.com).");
      return;
    }

    if (!currentPassword) {
      Alert.alert("Password Required", "Please enter your current password to save changes.");
      return;
    }

    if (editPassword && editPassword.length < 6) {
      Alert.alert("Weak Password", "New password must be at least 6 characters long.");
      return;
    }

    if (editPassword && editPassword !== editConfirmPassword) {
      Alert.alert("Password Mismatch", "New password and confirm password do not match.");
      return;
    }

    setIsSaving(true);

    try {
      // Step 1: Re-authenticate
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);

      // Step 2: Check if new email already exists (before sending verification)
      if (emailChanged) {
        const methods = await fetchSignInMethodsForEmail(auth, newEmail);
        if (methods && methods.length > 0) {
          Alert.alert(
            "Email Already in Use",
            "This email address is already registered with another account. Please use a different email."
          );
          setIsSaving(false);
          return;
        }
      }

      const userDocRef = doc(db, "users", user.uid);
      const firestoreUpdates = { fullName: editName.trim() };

      // Step 3: Update display name
      await updateProfile(user, { displayName: editName.trim() });

      // Step 4: Send verification to new email (does NOT change email until user clicks link)
      if (emailChanged) {
        await verifyBeforeUpdateEmail(user, newEmail);
        // Store pending email in Firestore so we can show it as "pending"
        await updateDoc(userDocRef, {
          ...firestoreUpdates,
          pendingEmail: newEmail,
          pendingEmailSentAt: Date.now(),
        });

        // Step 5: Update password if also changed
        if (editPassword) {
          await updatePassword(user, editPassword);
        }

        setShowEditModal(false);
        setCurrentPassword("");
        setEditPassword("");
        setEditConfirmPassword("");

        Alert.alert(
          "Verification Email Sent",
          `A verification link has been sent to:\n\n${newEmail}\n\nPlease open that email and click the link to complete your email change. Until then, your current email remains active.`,
          [{ text: "Got it", style: "default" }]
        );
        return;
      }

      // Step 5 (no email change): Update password if provided
      if (editPassword) {
        await updatePassword(user, editPassword);
      }

      // Step 6: Update Firestore
      await updateDoc(userDocRef, firestoreUpdates);

      Alert.alert("Success", "Profile updated successfully.");
      setShowEditModal(false);
      setCurrentPassword("");
      setEditPassword("");
      setEditConfirmPassword("");
      // onSnapshot automatically reflects Firestore changes

    } catch (error) {
      const code = error?.code || "";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        Alert.alert("Incorrect Password", "The current password you entered is wrong. Please try again.");
      } else if (code === "auth/email-already-in-use") {
        Alert.alert("Email Already in Use", "This email is already registered with another account.");
      } else if (code === "auth/invalid-email") {
        Alert.alert("Invalid Email", "Please enter a valid email address.");
      } else if (code === "auth/too-many-requests") {
        Alert.alert("Too Many Attempts", "Account temporarily locked. Please try again after some time.");
      } else if (code === "auth/network-request-failed") {
        Alert.alert("No Internet", "Please check your internet connection and try again.");
      } else if (code === "auth/requires-recent-login") {
        Alert.alert("Session Expired", "Please log out and log in again before making this change.");
      } else {
        Alert.alert("Update Failed", "Something went wrong. Please try again.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          try {
            await signOut(auth);
            router.replace("/screens/login");
          } catch (_) {}
        },
      },
    ]);
  };

  const handleOpenEditModal = () => {
    setEditName(userData?.fullName || "");
    setEditEmail(user?.email || "");
    setCurrentPassword("");
    setEditPassword("");
    setEditConfirmPassword("");
    setShowEditModal(true);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0D47A1" />
          <Text style={styles.loadingText}>Loading Profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* User Info Cards */}
        <View style={styles.infoSection}>
          {/* Name */}
          <View style={styles.infoCard}>
            <View style={styles.infoIconWrap}>
              <MaterialCommunityIcons name="account" size={22} color="#3B82F6" />
            </View>
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Full Name</Text>
              <Text style={styles.infoValue}>{userData?.fullName || "Not set"}</Text>
            </View>
          </View>

          {/* Email */}
          <View style={styles.infoCard}>
            <View style={[styles.infoIconWrap, { backgroundColor: "#F0FDF4" }]}>
              <MaterialCommunityIcons name="email" size={22} color="#22C55E" />
            </View>
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{userData?.email || user?.email || "Not set"}</Text>
              {userData?.pendingEmail && (
                <View style={styles.pendingEmailWrap}>
                  <MaterialCommunityIcons name="clock-outline" size={12} color="#D97706" />
                  <Text style={styles.pendingEmailText}>Pending: {userData.pendingEmail}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Role */}
          <View style={styles.infoCard}>
            <View style={[styles.infoIconWrap, { backgroundColor: "#FFF7ED" }]}>
              <MaterialCommunityIcons name="shield-account" size={22} color="#F97316" />
            </View>
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Role</Text>
              <View style={styles.roleBadge}>
                <Text style={styles.roleText}>
                  {userData?.role === "admin" ? "Administrator" : "User"}
                </Text>
              </View>
            </View>
          </View>

          {/* Member Since */}
          <View style={styles.infoCard}>
            <View style={[styles.infoIconWrap, { backgroundColor: "#F5F3FF" }]}>
              <MaterialCommunityIcons name="calendar" size={22} color="#8B5CF6" />
            </View>
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Member Since</Text>
              <Text style={styles.infoValue}>
                {userData?.createdAt
                  ? new Date(userData.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
                  : user?.metadata?.creationTime
                  ? new Date(user.metadata.creationTime).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
                  : "Unknown"}
              </Text>
            </View>
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.actionsSection}>
          <Text style={styles.actionsTitle}>Quick Actions</Text>

          <TouchableOpacity style={styles.actionCard} onPress={handleOpenEditModal}>
            <MaterialCommunityIcons name="account-edit" size={22} color="#3B82F6" />
            <Text style={styles.actionText}>Edit Profile</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionCard, styles.logoutCard]} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={22} color="#EF4444" />
            <Text style={[styles.actionText, { color: "#EF4444" }]}>Sign Out</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#EF4444" />
          </TouchableOpacity>
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>

      {/* Edit Profile Modal */}
      <Modal visible={showEditModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Profile</Text>
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Name Input */}
              <View style={styles.editInputWrap}>
                <Text style={styles.editInputLabel}>Full Name</Text>
                <TextInput
                  style={styles.editInput}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Enter your name"
                  placeholderTextColor="#94A3B8"
                />
              </View>

              {/* Email Input */}
              <View style={styles.editInputWrap}>
                <Text style={styles.editInputLabel}>Email Address</Text>
                <TextInput
                  style={styles.editInput}
                  value={editEmail}
                  onChangeText={setEditEmail}
                  placeholder="Enter your email"
                  placeholderTextColor="#94A3B8"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              {/* Divider */}
              <View style={styles.sectionDivider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>Change Password (optional)</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* New Password */}
              <View style={styles.editInputWrap}>
                <Text style={styles.editInputLabel}>New Password</Text>
                <View style={styles.passwordWrap}>
                  <TextInput
                    style={styles.passwordInput}
                    value={editPassword}
                    onChangeText={setEditPassword}
                    placeholder="Leave blank to keep current"
                    placeholderTextColor="#94A3B8"
                    secureTextEntry={!showNewPass}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={() => setShowNewPass(!showNewPass)} style={styles.eyeBtn}>
                    <MaterialCommunityIcons name={showNewPass ? "eye-off" : "eye"} size={20} color="#94A3B8" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Confirm New Password */}
              <View style={styles.editInputWrap}>
                <Text style={styles.editInputLabel}>Confirm New Password</Text>
                <View style={styles.passwordWrap}>
                  <TextInput
                    style={styles.passwordInput}
                    value={editConfirmPassword}
                    onChangeText={setEditConfirmPassword}
                    placeholder="Re-enter new password"
                    placeholderTextColor="#94A3B8"
                    secureTextEntry={!showConfirmPass}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={() => setShowConfirmPass(!showConfirmPass)} style={styles.eyeBtn}>
                    <MaterialCommunityIcons name={showConfirmPass ? "eye-off" : "eye"} size={20} color="#94A3B8" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Divider */}
              <View style={styles.sectionDivider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>Confirm Identity</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Current Password (required to save) */}
              <View style={styles.editInputWrap}>
                <Text style={styles.editInputLabel}>Current Password <Text style={styles.requiredText}>(required)</Text></Text>
                <View style={styles.passwordWrap}>
                  <TextInput
                    style={styles.passwordInput}
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    placeholder="Enter current password to confirm"
                    placeholderTextColor="#94A3B8"
                    secureTextEntry={!showCurrentPass}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={() => setShowCurrentPass(!showCurrentPass)} style={styles.eyeBtn}>
                    <MaterialCommunityIcons name={showCurrentPass ? "eye-off" : "eye"} size={20} color="#94A3B8" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Save Button */}
              <TouchableOpacity
                style={[styles.saveButton, isSaving && { opacity: 0.6 }]}
                onPress={handleSaveProfile}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.saveButtonText}>Save Changes</Text>
                )}
              </TouchableOpacity>

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F8FAFC" },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 12, fontSize: 15, color: "#64748B" },

  // Header
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, backgroundColor: "#FFF", borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  headerTitle: { fontSize: 20, fontWeight: "700", color: "#0F172A" },

  container: { flex: 1 },

  // Info Cards
  infoSection: { paddingHorizontal: 16, paddingTop: 20, gap: 10 },
  infoCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFF", padding: 16, borderRadius: 14, elevation: 1, borderWidth: 1, borderColor: "#F1F5F9" },
  infoIconWrap: { width: 42, height: 42, borderRadius: 12, backgroundColor: "#EFF6FF", justifyContent: "center", alignItems: "center", marginRight: 14 },
  infoContent: { flex: 1 },
  infoLabel: { fontSize: 12, color: "#94A3B8", marginBottom: 2, fontWeight: "500" },
  infoValue: { fontSize: 15, color: "#1E293B", fontWeight: "600" },
  roleBadge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 3, backgroundColor: "#FEF3C7", borderRadius: 12, marginTop: 4 },
  roleText: { fontSize: 12, color: "#D97706", fontWeight: "600" },
  pendingEmailWrap: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  pendingEmailText: { fontSize: 11, color: "#D97706", fontWeight: "500", fontStyle: "italic" },

  // Actions
  actionsSection: { paddingHorizontal: 16, marginTop: 24 },
  actionsTitle: { fontSize: 16, fontWeight: "700", color: "#0F172A", marginBottom: 12 },
  actionCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFF", padding: 16, borderRadius: 14, marginBottom: 8, gap: 12, elevation: 1, borderWidth: 1, borderColor: "#F1F5F9" },
  actionText: { flex: 1, fontSize: 15, color: "#334155", fontWeight: "500" },
  logoutCard: { borderColor: "#FEE2E2", backgroundColor: "#FFF5F5" },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: "#FFF", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 10, maxHeight: "90%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: "#F1F5F9", marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#0F172A" },

  editInputWrap: { marginBottom: 14 },
  editInputLabel: { fontSize: 13, color: "#64748B", marginBottom: 6, fontWeight: "500" },
  editInput: { backgroundColor: "#F8FAFC", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: "#1E293B", borderWidth: 1, borderColor: "#E2E8F0" },

  // Password field
  passwordWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderRadius: 12, borderWidth: 1, borderColor: "#E2E8F0" },
  passwordInput: { flex: 1, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: "#1E293B" },
  eyeBtn: { paddingHorizontal: 14 },

  // Divider
  sectionDivider: { flexDirection: "row", alignItems: "center", marginVertical: 14, gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#E2E8F0" },
  dividerText: { fontSize: 11, color: "#94A3B8", fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  requiredText: { color: "#EF4444", fontWeight: "400" },

  saveButton: { backgroundColor: "#2563EB", borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 6 },
  saveButtonText: { color: "#FFF", fontSize: 16, fontWeight: "600" },
});