import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Image,
  ImageBackground,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

export default function ForgetPassword() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const handleInputChange = (setter) => (value) => {
    setter(value);
    if (errorMessage) setErrorMessage(null);
    if (successMessage) setSuccessMessage(null);
  };

  const handleReset = () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!email) {
      setErrorMessage("Please enter your email");
      return;
    }

    setSuccessMessage("Password reset email sent! Check your inbox.");
  };

  const handleBackToLogin = () => {
    router.push("screens/login");
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent />

      <ImageBackground
        source={require("../../assets/images/bg.png")}
        style={styles.background}
      >
        <View style={styles.safeArea}>
          <View style={styles.content}>

            
            <View style={styles.logoContainer}>
              <Image
                source={require("../../assets/images/sehat_logo.png")}
                style={styles.logo}
                resizeMode="contain"
              />
              <Text style={styles.title}>Forgot Password</Text>
              <Text style={styles.subtitle}>
                Enter your email to reset your password
              </Text>
            </View>

            
            <View style={styles.form}>
              <TextInput
                placeholder="Email"
                value={email}
                onChangeText={handleInputChange(setEmail)}
                style={styles.input}
                placeholderTextColor="#999"
                keyboardType="email-address"
              />
            </View>

            
            {errorMessage && (
              <Text style={{ color: "red", marginBottom: 10 }}>
                {errorMessage}
              </Text>
            )}
            {successMessage && (
              <Text style={{ color: "green", marginBottom: 10 }}>
                {successMessage}
              </Text>
            )}

            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.buttonShadow}
              onPress={handleReset}
            >
              <LinearGradient
                colors={["#5DB8FF", "#3EADCF", "#ABE098"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.button}
              >
                <Text style={styles.buttonText}>RESET PASSWORD</Text>
              </LinearGradient>
            </TouchableOpacity>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Remembered your password?</Text>
              <TouchableOpacity onPress={handleBackToLogin}>
                <Text style={styles.signinText}> Login In</Text>
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
  },
  background: {
    flex: 1,
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
    marginTop: 40,
  },
  logo: {
    width: 200,
    height: 200,
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#333",
    marginTop: 10,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 5,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  form: {
    width: "100%",
    marginTop: 10,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 25,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 15,
    fontSize: 15,
    elevation: 3,
  },
  buttonShadow: {
    width: "75%",
    borderRadius: 30,
    elevation: 8,
    marginBottom: 20,
  },
  button: {
    paddingVertical: 18,
    borderRadius: 30,
    alignItems: "center",
  },
  buttonText: {
    color: "#FFF",
    fontWeight: "bold",
    fontSize: 16,
    letterSpacing: 1.2,
  },
  footer: {
    flexDirection: "row",
    marginBottom: 30,
  },
  footerText: {
    color: "#555",
    fontSize: 14,
  },
  signinText: {
    color: "#3EADCF",
    fontWeight: "bold",
    fontSize: 14,
  },
});
