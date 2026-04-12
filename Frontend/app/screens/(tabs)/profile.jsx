import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ComingSoonScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar style="light" />

      <View style={styles.container}>
        {/* Icon */}
        <View style={styles.iconWrapper}>
          <MaterialCommunityIcons
            name="rocket-launch"
            size={70}
            color="#00BCD4"
          />
        </View>

        {/* Title */}
        <Text style={styles.title}>Coming Soon</Text>

        {/* Subtitle */}
        <Text style={styles.subtitle}>
          We are working hard to bring this feature to you.
        </Text>

        {/* Highlight Card */}
        <View style={styles.card}>
          <MaterialCommunityIcons
            name="medical-bag"
            size={28}
            color="#0D47A1"
          />
          <Text style={styles.cardText}>
            AI-powered health features will be available very soon.
          </Text>
        </View>

        {/* Extra Info */}
        <Text style={styles.infoText}>
          Smart diagnosis, treatment recommendations,
          and bilingual AI support are on the way.
        </Text>

        {/* Button */}
        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation?.goBack()}
        >
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0D47A1",
  },

  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },

  iconWrapper: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#E3F2FD",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 30,
  },

  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#0D47A1",
    marginBottom: 10,
  },

  subtitle: {
    fontSize: 16,
    color: "#64748B",
    textAlign: "center",
    marginBottom: 30,
  },

  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    padding: 18,
    borderRadius: 16,
    marginBottom: 20,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },

  cardText: {
    fontSize: 15,
    color: "#1E293B",
    marginLeft: 12,
    flex: 1,
  },

  infoText: {
    fontSize: 14,
    color: "#475569",
    textAlign: "center",
    marginBottom: 40,
    lineHeight: 20,
  },

  button: {
    backgroundColor: "#00BCD4",
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 30,
  },

  buttonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
});


