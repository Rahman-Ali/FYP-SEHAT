//D:\project\Frontend\app\screens\(tabs)\profile.jsx
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { getAuth, signOut, updateProfile } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
  const [showMenu, setShowMenu] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  
  // Edit state
  const [editName, setEditName] = useState("");
  const [editProfilePic, setEditProfilePic] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        router.replace("/screens/login");
        return;
      }
      setUser(currentUser);
      
      // Fetch Firestore data
      const userDocRef = doc(db, "users", currentUser.uid);
      const userDocSnap = await getDoc(userDocRef);
      
      if (userDocSnap.exists()) {
        const data = userDocSnap.data();
        setUserData(data);
        setEditName(data.fullName || "");
      }
    } catch (error) {
      console.error("Error loading user:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission Denied", "Please allow access to photos.");
      return;
    }
    
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    
    if (!result.canceled) {
      setEditProfilePic(result.assets[0].uri);
    }
  };

  const handleSaveProfile = async () => {
    if (!editName.trim()) {
      Alert.alert("Error", "Name cannot be empty");
      return;
    }
    
    setIsSaving(true);
    
    try {
      // Update Firestore
      const userDocRef = doc(db, "users", user.uid);
      await updateDoc(userDocRef, {
        fullName: editName.trim(),
      });
      
      // Update Firebase Auth display name
      await updateProfile(user, {
        displayName: editName.trim(),
      });
      
      // Upload profile picture if selected
      if (editProfilePic) {
        const storage = getStorage();
        const storageRef = ref(storage, `profile_pictures/${user.uid}.jpg`);
        
        const response = await fetch(editProfilePic);
        const blob = await response.blob();
        
        await uploadBytes(storageRef, blob);
        const photoURL = await getDownloadURL(storageRef);
        
        await updateProfile(user, { photoURL });
        await updateDoc(userDocRef, { profilePic: photoURL });
      }
      
      Alert.alert("Success", "Profile updated successfully");
      setShowEditModal(false);
      loadUserData(); // Reload data
    } catch (error) {
      console.error("Error updating profile:", error);
      Alert.alert("Error", "Failed to update profile");
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
          } catch (error) {
            console.error("Logout error:", error);
          }
        },
      },
    ]);
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
        {/* <TouchableOpacity 
          style={styles.menuButton} 
          onPress={() => setShowMenu(!showMenu)}
        >
          <MaterialCommunityIcons name="dots-vertical" size={24} color="#1E293B" />
        </TouchableOpacity> */}
      </View>
     {/* Dropdown Menu
      {showMenu && (
        <View style={styles.dropdownMenu}>
          <TouchableOpacity 
            style={styles.dropdownItem}
            onPress={() => { setShowMenu(false); setShowEditModal(true); }}
          >
            <MaterialCommunityIcons name="account-edit" size={20} color="#334155" />
            <Text style={styles.dropdownText}>Update Details</Text>
          </TouchableOpacity>
          <View style={styles.dropdownDivider} />
          <TouchableOpacity 
            style={styles.dropdownItem}
            onPress={() => { setShowMenu(false); handleLogout(); }}
          >
            <MaterialCommunityIcons name="logout" size={20} color="#EF4444" />
            <Text style={[styles.dropdownText, { color: "#EF4444" }]}>Logout</Text>
          </TouchableOpacity>
        </View>
      )} */}
 
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Profile Picture */}
        <View style={styles.profilePicSection}>
          <View style={styles.profilePicContainer}>
            {userData?.profilePic || user?.photoURL ? (
              <Image 
                source={{ uri: userData?.profilePic || user?.photoURL }} 
                style={styles.profilePic} 
              />
            ) : (
              <View style={styles.profilePicPlaceholder}>
                <MaterialCommunityIcons name="account" size={60} color="#94A3B8" />
              </View>
            )}
          </View>
        </View>

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
          
          <TouchableOpacity style={styles.actionCard} onPress={() => setShowEditModal(true)}>
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

            {/* Profile Picture Edit */}
            <TouchableOpacity style={styles.editPicSection} onPress={handlePickImage}>
              <View style={styles.editPicContainer}>
                {editProfilePic ? (
                  <Image source={{ uri: editProfilePic }} style={styles.editPic} />
                ) : userData?.profilePic || user?.photoURL ? (
                  <Image source={{ uri: userData?.profilePic || user?.photoURL }} style={styles.editPic} />
                ) : (
                  <View style={styles.editPicPlaceholder}>
                    <MaterialCommunityIcons name="camera" size={30} color="#94A3B8" />
                  </View>
                )}
                <View style={styles.cameraIconWrap}>
                  <MaterialCommunityIcons name="camera-plus" size={16} color="#FFF" />
                </View>
              </View>
              <Text style={styles.editPicLabel}>Change Photo</Text>
            </TouchableOpacity>

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
  //menuButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#F1F5F9", justifyContent: "center", alignItems: "center" },
  
  // Dropdown
  // dropdownMenu: { position: "absolute", top: 65, right: 16, backgroundColor: "#FFF", borderRadius: 14, paddingVertical: 4, elevation: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8, zIndex: 100, minWidth: 180, borderWidth: 1, borderColor: "#F1F5F9" },
  // dropdownItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  // dropdownText: { fontSize: 14, color: "#334155", fontWeight: "500" },
  // dropdownDivider: { height: 1, backgroundColor: "#F1F5F9", marginHorizontal: 12 },
  
  container: { flex: 1 },
  
  // Profile Picture
  profilePicSection: { alignItems: "center", paddingVertical: 30 },
  profilePicContainer: { width: 120, height: 120, borderRadius: 60, overflow: "hidden", borderWidth: 3, borderColor: "#E2E8F0" },
  profilePic: { width: "100%", height: "100%" },
  profilePicPlaceholder: { width: "100%", height: "100%", backgroundColor: "#F1F5F9", justifyContent: "center", alignItems: "center" },
  
  // Info Cards
  infoSection: { paddingHorizontal: 16, gap: 10 },
  infoCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFF", padding: 16, borderRadius: 14, elevation: 1, borderWidth: 1, borderColor: "#F1F5F9" },
  infoIconWrap: { width: 42, height: 42, borderRadius: 12, backgroundColor: "#EFF6FF", justifyContent: "center", alignItems: "center", marginRight: 14 },
  infoContent: { flex: 1 },
  infoLabel: { fontSize: 12, color: "#94A3B8", marginBottom: 2, fontWeight: "500" },
  infoValue: { fontSize: 15, color: "#1E293B", fontWeight: "600" },
  roleBadge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 3, backgroundColor: "#FEF3C7", borderRadius: 12, marginTop: 4 },
  roleText: { fontSize: 12, color: "#D97706", fontWeight: "600" },
  
  // Actions
  actionsSection: { paddingHorizontal: 16, marginTop: 24 },
  actionsTitle: { fontSize: 16, fontWeight: "700", color: "#0F172A", marginBottom: 12 },
  actionCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFF", padding: 16, borderRadius: 14, marginBottom: 8, gap: 12, elevation: 1, borderWidth: 1, borderColor: "#F1F5F9" },
  actionText: { flex: 1, fontSize: 15, color: "#334155", fontWeight: "500" },
  logoutCard: { borderColor: "#FEE2E2", backgroundColor: "#FFF5F5" },
  
  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: "#FFF", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 30, maxHeight: "80%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#0F172A" },
  
  editPicSection: { alignItems: "center", paddingVertical: 20 },
  editPicContainer: { width: 100, height: 100, borderRadius: 50, overflow: "hidden", borderWidth: 2, borderColor: "#E2E8F0", position: "relative" },
  editPic: { width: "100%", height: "100%" },
  editPicPlaceholder: { width: "100%", height: "100%", backgroundColor: "#F1F5F9", justifyContent: "center", alignItems: "center" },
  cameraIconWrap: { position: "absolute", bottom: 0, right: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: "#3B82F6", justifyContent: "center", alignItems: "center", borderWidth: 2, borderColor: "#FFF" },
  editPicLabel: { fontSize: 13, color: "#3B82F6", fontWeight: "500", marginTop: 8 },
  
  editInputWrap: { marginBottom: 16 },
  editInputLabel: { fontSize: 13, color: "#64748B", marginBottom: 6, fontWeight: "500" },
  editInput: { backgroundColor: "#F8FAFC", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: "#1E293B", borderWidth: 1, borderColor: "#E2E8F0" },
  
  saveButton: { backgroundColor: "#2563EB", borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 10 },
  saveButtonText: { color: "#FFF", fontSize: 16, fontWeight: "600" },
});