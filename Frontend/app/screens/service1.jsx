import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  Image,
  ImageBackground,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from "@expo-google-fonts/poppins";

export default function Service1() {
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    "Poppins-Regular": Poppins_400Regular,
    "Poppins-Medium": Poppins_500Medium,
    "Poppins-SemiBold": Poppins_600SemiBold,
    "Poppins-Bold": Poppins_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading SEHAT...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      <ImageBackground
        source={require("../../assets/images/bg.png")}
        resizeMode="cover"
        style={styles.background}
      >
        <View style={styles.content}>
          
          
          <Image
            source={require("../../assets/images/s1.png")}
            style={styles.image}
            resizeMode="contain"
          />

         
          
          <View style={styles.textContainer}>
            <Text style={styles.title}>
              Your AI-Powered Health Assistant
            </Text>
            <Text style={styles.description}>
              Get instant health guidance, symptom analysis, and emergency first
              aid support anytime, anywhere.
            </Text>
          </View>

          
          
          <View style={styles.bottom}>
           
            
            <View style={styles.nextButtonContainer}>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.NextbuttonShadow}
                onPress={() => router.push("/screens/service2")}
              >
                <LinearGradient
                  colors={["#5DB8FF", "#3EADCF", "#ABE098"]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.Nextbutton}
                >
                  <Text style={styles.NextbuttonText}>NEXT</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>

            
            <View style={styles.dotsContainer}>
              <View style={[styles.dot, styles.activeDot]} />
              <View style={styles.dot} />
              <View style={styles.dot} />
              <View style={styles.dot} />
            </View>
          </View>

       
          <TouchableOpacity
            onPress={() => router.replace("/screens/login")}
            style={styles.skipButton}
          >
            <Text style={styles.skip}>Skip</Text>
          </TouchableOpacity>
        </View>
      </ImageBackground>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#000",
  },
  background: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 40,
  },
  logo: {
    width: 120,
    height: 120,
    marginTop: 20,
  },
  image: {
    width: "90%",
    height: 280,
    maxWidth: 320,
  },
  textContainer: {
    alignItems: "center",
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 25,
    fontFamily: "Poppins-Bold",
    color: "#00BCD4",
    marginBottom: 8,
    textAlign: "center",
  },
  description: {
    fontSize: 16,
    fontFamily: "Poppins-Regular",
    color: "#06020b00",
    textAlign: "center",
    lineHeight: 24,
  },
  bottom: {
    width: "100%",
    alignItems: "center",
    marginBottom: 20,
  },

  nextButtonContainer: {
    marginBottom: 18,
  },

  dotsContainer: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
  },

  dots: {
    flexDirection: "row",
    gap: 10,
  },
  dot: {
    width: 28,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(24, 123, 64, 0.4)",
  },
  activeDot: {
    width: 38,
    backgroundColor: "#00BCD4",
  },
  NextbuttonShadow: {
    width: "85%",
    borderRadius: 30,
    elevation: 12,
    marginBottom: 20,
    shadowColor: "#0097A7",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    overflow: "hidden", 
  },
  Nextbutton: {
    marginTop: 10,
    paddingVertical: 20,
    paddingHorizontal: 65,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  NextbuttonText: {
    color: "#FFFFFF",
    fontFamily: "Poppins-Bold", 
    fontSize: 18,
    letterSpacing: 1.2,
    textShadowColor: "rgba(0, 0, 0, 0.15)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    fontWeight: "700",
  },

skipButton: {
  position: 'absolute',
  top: 10,
  right: 10,
  paddingVertical: 10,
  paddingHorizontal: 25,
  borderRadius: 20,
  backgroundColor: 'rgba(185, 142, 142, 0.11)',
  backdropFilter: 'blur(10px)',
  borderWidth: 1,
  borderColor: 'rgba(0, 0, 0, 0.05)',
},
skip: {
  fontFamily: "Poppins-Medium",
  color: "#1fc9c9ff",
  fontSize: 15,
  letterSpacing: 0.3,
  opacity: 0.9,
},
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0D47A1",
  },
  loadingText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontFamily: "Poppins-Medium",
  },
});
