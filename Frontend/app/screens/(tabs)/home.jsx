import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router"; // ✅ Added
import { StatusBar } from "expo-status-bar";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { app } from "../../../firebase.config";

const db = getFirestore(app);
const auth = getAuth(app);

export default function HomeScreen() {
  const router = useRouter();  // ✅ Added
  const [userName, setUserName] = useState("User");
  const [userActivity, setUserActivity] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const docRef = doc(db, "users", user.uid);
          const docSnap = await getDoc(docRef);

          if (docSnap.exists()) {
            const userData = docSnap.data();
            const firstName = userData.fullName
              ? userData.fullName.split(" ")[0]
              : "User";
            setUserName(firstName);
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
        }
      }
    });

    fetchUserActivity();
    return () => unsubscribe();
  }, []);

  const fetchUserActivity = async () => {
    try {
      setIsLoading(true);

      const chatHistory = await AsyncStorage.getItem("chat_history");
      if (chatHistory) {
        const history = JSON.parse(chatHistory);

        const activities = history.slice(0, 3).map((chat, index) => ({
          id: chat.id || index,
          title: chat.title || "Medical Consultation",
          date: chat.timestamp ? formatDate(chat.timestamp) : "Recently",
          preview: chat.preview || "Check your symptoms",
          isChat: true,
        }));

        setUserActivity(activities);
      } else {
        setUserActivity([]);
      }
    } catch (error) {
      console.error("Error fetching activity:", error);
      setUserActivity([]);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  const getRandomTip = () => {
    const healthTips = [
      "Drink at least 8 glasses of water daily",
      "Get 7-8 hours of sleep every night",
      "Exercise for 30 minutes daily",
      "Eat balanced meals with fruits and vegetables",
      "Manage stress through meditation or deep breathing",
      "Wash hands regularly to prevent infections",
      "Limit sugar and processed food intake",
      "Take regular breaks from screens",
    ];
    return healthTips[Math.floor(Math.random() * healthTips.length)];
  };

  const showComingSoon = (feature) => {
    Alert.alert("Coming Soon", `${feature} feature is currently under development.`);
  };

  const navigateToActivity = (item) => {
    if (item.isChat) {
      // ✅ Changed to router.push
      router.push({
        pathname: "/screens/chatbot",
        params: {
          sessionId: item.id,
          title: item.title,
        },
      });
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <LinearGradient
          colors={["#0D47A1", "#1565C0"]}
          style={styles.headerGradient}
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.greeting}>Welcome back, {userName}! 👋</Text>
              <Text style={styles.healthStatus}>
                How are you feeling today?
              </Text>
            </View>
            <TouchableOpacity
              style={styles.notificationBtn}
              onPress={() => showComingSoon("Profile")}
            >
              <MaterialCommunityIcons name="account" size={24} color="#FFF" />
            </TouchableOpacity>
          </View>
        </LinearGradient>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Your Recent Activity</Text>
            {userActivity.length > 0 && (
              // ✅ Changed to router.push
              <TouchableOpacity onPress={() => router.push("/screens/history")}>
                <Text style={styles.seeAll}>See All</Text>
              </TouchableOpacity>
            )}
          </View>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <MaterialCommunityIcons name="loading" size={30} color="#00BCD4" />
              <Text style={styles.loadingText}>Loading your activity...</Text>
            </View>
          ) : userActivity.length > 0 ? (
            userActivity.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.activityCard}
                onPress={() => navigateToActivity(item)}
                activeOpacity={0.7}
              >
                <View style={styles.activityIcon}>
                  <MaterialCommunityIcons
                    name="message-text"
                    size={22}
                    color="#0D47A1"
                  />
                </View>
                <View style={styles.activityContent}>
                  <Text style={styles.activityTitle}>{item.title}</Text>
                  <Text style={styles.activityPreview} numberOfLines={1}>
                    {item.preview}
                  </Text>
                  <Text style={styles.activityDate}>{item.date}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color="#999" />
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyActivity}>
              <MaterialCommunityIcons
                name="clipboard-text-outline"
                size={50}
                color="#E2E8F0"
              />
              <Text style={styles.emptyActivityText}>No recent activity</Text>
              <Text style={styles.emptyActivitySubtext}>
                Start by chatting with AI Assistant
              </Text>
              {/* ✅ Changed to router.push */}
              <TouchableOpacity
                style={styles.startButton}
                onPress={() => router.push("/screens/chatbot")}
              >
                <Text style={styles.startButtonText}>Start Chat Now</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.tipSection}>
          <Text style={styles.sectionTitle}>Daily Health Tip</Text>
          <LinearGradient colors={["#00BCD4", "#0097A7"]} style={styles.tipCard}>
            <MaterialCommunityIcons name="lightbulb-on" size={40} color="#FFF" />
            <View style={styles.tipContent}>
              <Text style={styles.tipTitle}>Stay Healthy</Text>
              <Text style={styles.tipText}>{getRandomTip()}</Text>
            </View>
          </LinearGradient>
        </View>

        <View style={styles.emergencySection}>
          <Text style={styles.sectionTitle}>Emergency Access</Text>
          <TouchableOpacity
            style={styles.emergencyCard}
            onPress={() => showComingSoon("Emergency Services")}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={["#FF5252", "#D32F2F"]}
              style={styles.emergencyGradient}
            >
              <MaterialCommunityIcons name="phone-in-talk" size={40} color="#FFF" />
              <View style={styles.emergencyContent}>
                <Text style={styles.emergencyTitle}>Emergency Contact</Text>
                <Text style={styles.emergencyNumber}>1122 / 15</Text>
                <Text style={styles.emergencyText}>
                  Tap for emergency services and first aid guides
                </Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F5F7FA",
  },
  container: {
    flex: 1,
  },
  headerGradient: {
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 30,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  greeting: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 5,
  },
  healthStatus: {
    fontSize: 16,
    color: "rgba(255, 255, 255, 0.9)",
  },
  notificationBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 25,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#0D47A1",
  },
  seeAll: {
    color: "#00BCD4",
    fontWeight: "600",
    fontSize: 14,
  },
  loadingContainer: {
    alignItems: "center",
    padding: 30,
  },
  loadingText: {
    marginTop: 10,
    color: "#666",
    fontSize: 14,
  },
  activityCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  activityIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#E3F2FD",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
  },
  activityContent: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 3,
  },
  activityPreview: {
    fontSize: 13,
    color: "#666",
    marginBottom: 4,
  },
  activityDate: {
    fontSize: 11,
    color: "#999",
  },
  emptyActivity: {
    alignItems: "center",
    padding: 40,
    backgroundColor: "#FFF",
    borderRadius: 15,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  emptyActivityText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#666",
    marginTop: 15,
    marginBottom: 5,
  },
  emptyActivitySubtext: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  startButton: {
    backgroundColor: "#00BCD4",
    paddingHorizontal: 25,
    paddingVertical: 12,
    borderRadius: 25,
  },
  startButtonText: {
    color: "#FFF",
    fontWeight: "600",
    fontSize: 14,
  },
  tipSection: {
    paddingHorizontal: 20,
    marginTop: 10,
    marginBottom: 20,
  },
  tipCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    borderRadius: 15,
    marginTop: 10,
  },
  tipContent: {
    flex: 1,
    marginLeft: 15,
  },
  tipTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 5,
  },
  tipText: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.9)",
    lineHeight: 20,
  },
  emergencySection: {
    paddingHorizontal: 20,
    marginBottom: 30,
  },
  emergencyCard: {
    borderRadius: 15,
    overflow: "hidden",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  emergencyGradient: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
  },
  emergencyContent: {
    flex: 1,
    marginLeft: 15,
  },
  emergencyTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 5,
  },
  emergencyNumber: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 5,
  },
  emergencyText: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.9)",
  },
});