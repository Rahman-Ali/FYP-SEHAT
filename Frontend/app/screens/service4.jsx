import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  Image,
  ImageBackground,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";


export default function Service4() {
  const router = useRouter();

  const handleNext = () => {
    router.push("screens/signup");
  };

  return (
    <View style={styles.container}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor="transparent"
        translucent
      />

      
      <ImageBackground
        source={require("../../assets/images/bg.png")}
        style={styles.background}
        resizeMode="cover"
      >
        <View style={styles.safeArea}>
          <View style={styles.content}>
            
            
            <View style={styles.logoContainer}>
              <Image
                source={require("../../assets/images/sehat_logo.png")}
                style={styles.logo}
                resizeMode="contain"
              />
              <Text style={styles.tagline}>Let's Start to the Modern Approach!</Text>
            </View>

            
            <View style={styles.footer}>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.buttonShadow}
                onPress={handleNext}
              >
                <LinearGradient
                  colors={["#5DB8FF", "#3EADCF", "#ABE098"]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>GET STARTED</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignContent: "center",
    justifyContent: "center",
  },
  background: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 20,
  },
  logoContainer: {
    alignItems: "center",
    marginTop: 60,
  },
  logo: {
    width: 250,
    height: 250,
    marginBottom: 10,
  },
  tagline: {
    fontSize: 15,
    color: "#7B7B7B",
    marginTop: 10,
    textAlign: "center",
    fontWeight: "bold",
  },
  footer: {
    width: "100%",
    alignItems: "center",
    marginBottom: 40,
  },
  buttonShadow: {
    width: "75%",
    borderRadius: 30,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    marginBottom: 20, // pushes button upward
  },
  button: {
    paddingVertical: 18,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "bold",
    fontSize: 16,
    letterSpacing: 1.2,
  },
});
