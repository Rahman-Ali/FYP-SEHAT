//D:\project\Frontend\app\screens\signup.jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { auth, db } from "../../firebase.config";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [errorMessage, setErrorMessage] = useState(null);
  const [emailSent, setEmailSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const router = useRouter();
  
  // 🎯 Track email verification check interval
  const verificationIntervalRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (verificationIntervalRef.current) {
        clearInterval(verificationIntervalRef.current);
        verificationIntervalRef.current = null;
      }
    };
  }, []);

  const handleInputChange = (setter) => (value) => {
    setter(value);
    if (errorMessage) {
      setErrorMessage(null);
    }
  };

  // 🎯 Start email verification check (NO nested onSnapshot)
  const startEmailVerificationCheck = (user) => {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        try {
          await user.reload();
          if (user.emailVerified) {
            clearInterval(interval);
            verificationIntervalRef.current = null;
            resolve();
          }
        } catch (error) {
          clearInterval(interval);
          verificationIntervalRef.current = null;
          resolve(); // Resolve anyway to prevent hanging
        }
      }, 2000); // Check every 2 seconds

      verificationIntervalRef.current = interval;
    });
  };

  const handleSignup = async () => {
    setErrorMessage(null);

    // Basic Validation
    if (!fullName.trim()) {
      setErrorMessage("Full Name is required");
      return;
    }

    if (!email || !password) {
      setErrorMessage("Email and password are required");
      return;
    }

    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters");
      return;
    }

    setIsLoading(true);

    try {
      // Create User
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      const user = userCredential.user;

      // Save User Data in Firestore
      await setDoc(doc(db, "users", user.uid), {
        fullName: fullName,
        email: email,
        role: "user",
        createdAt: new Date().toISOString(),
      });

      // Send Verification Email
      await sendEmailVerification(user);

      // ✅ Mark Registration Complete
      await AsyncStorage.setItem(
        "hasCompletedRegistration",
        "true"
      );

      setIsLoading(false);
      setEmailSent(true);

      // 🎯 Start checking for email verification
      startEmailVerificationCheck(user).then(() => {
        // Email verified, navigate to home
        router.replace("/screens/(tabs)/home");
      });

    } catch (error) {
      setIsLoading(false);

      if (error.code === "auth/email-already-in-use") {
        setErrorMessage("That email address is already in use!");
      } else if (error.code === "auth/invalid-email") {
        setErrorMessage("That email address is invalid!");
      } else {
        setErrorMessage(error.message);
      }
    }
  };

  // 🎯 Manual verify button handler
  const handleManualVerify = async () => {
    try {
      const user = auth.currentUser;
      if (user) {
        await user.reload();
        if (user.emailVerified) {
          router.replace("/screens/(tabs)/home");
        } else {
          Alert.alert(
            "Not Verified",
            "Please verify your email first. Check your inbox and spam folder.",
            [{ text: "OK" }]
          );
        }
      }
    } catch (error) {
      Alert.alert("Error", "Could not check verification status");
    }
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
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.keyboardView}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.content}>
              <View style={styles.logoContainer}>
                <Image
                  source={require("../../assets/images/sehat_logo.png")}
                  style={styles.logo}
                  resizeMode="contain"
                />
                <Text style={styles.title}>Create Account</Text>
              </View>

              <View style={styles.form}>
                <TextInput
                  placeholder="Full Name"
                  value={fullName}
                  onChangeText={handleInputChange(setFullName)}
                  style={styles.input}
                  placeholderTextColor="#999"
                />
                <TextInput
                  placeholder="Email"
                  value={email}
                  onChangeText={handleInputChange(setEmail)}
                  style={styles.input}
                  placeholderTextColor="#999"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <TextInput
                  placeholder="Password"
                  value={password}
                  onChangeText={handleInputChange(setPassword)}
                  style={styles.input}
                  placeholderTextColor="#999"
                  secureTextEntry
                />
              </View>

              {errorMessage && (
                <Text style={{ color: "red", marginBottom: 10 }}>
                  {errorMessage}
                </Text>
              )}

              {!emailSent && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.buttonShadow}
                  onPress={handleSignup}
                  disabled={isLoading}
                >
                  <LinearGradient
                    colors={["#5DB8FF", "#3EADCF", "#ABE098"]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={styles.button}
                  >
                    {isLoading ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text style={styles.buttonText}>SIGN UP</Text>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              )}

              {emailSent && (
                <View style={{ alignItems: "center", marginBottom: 20 }}>
                  <Text
                    style={{
                      color: "green",
                      marginBottom: 10,
                      textAlign: "center",
                    }}
                  >
                    Verification email sent! Please check your inbox.
                    {"\n"}Waiting for verification...
                  </Text>
                  <ActivityIndicator size="small" color="#3EADCF" />
                  <TouchableOpacity
                    style={{ marginTop: 15 }}
                    onPress={handleManualVerify}
                  >
                    <Text style={{ color: "#3EADCF", fontWeight: "bold" }}>
                      I've verified my email
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.footer}>
                <Text style={styles.footerText}>Already have an account? </Text>
                <TouchableOpacity onPress={() => router.push("screens/login")}>
                  <Text style={styles.signinText}>Login</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </ImageBackground>
    </View>
  );
}

// 🎨 Styles remain exactly the same as original
const styles = StyleSheet.create({
  // ... ALL ORIGINAL STYLES UNCHANGED ...
  container: { flex: 1 },
  background: { flex: 1 },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "center" },
  content: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, paddingVertical: 40 },
  logoContainer: { alignItems: "center", marginBottom: 30 },
  logo: { width: 150, height: 150 },
  title: { fontSize: 24, fontWeight: "bold", color: "#333", marginTop: 10 },
  form: { width: "100%", marginBottom: 20 },
  input: { backgroundColor: "#FFFFFF", borderRadius: 25, paddingVertical: 14, paddingHorizontal: 20, marginBottom: 15, fontSize: 15, elevation: 3, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  buttonShadow: { width: "80%", borderRadius: 30, elevation: 8, marginBottom: 20, shadowColor: "#3EADCF", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5 },
  button: { paddingVertical: 16, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#FFF", fontWeight: "bold", fontSize: 16, letterSpacing: 1.2 },
  footer: { flexDirection: "row", marginTop: 10, marginBottom: 30 },
  footerText: { color: "#555", fontSize: 14 },
  signinText: { color: "#3EADCF", fontWeight: "bold", fontSize: 14 },
});