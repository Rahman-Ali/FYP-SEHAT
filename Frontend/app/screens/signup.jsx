import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useState } from "react";
import {
  ActivityIndicator,
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

  const handleInputChange = (setter) => (value) => {
    setter(value);
    if (errorMessage) {
      setErrorMessage(null);
    }
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
      
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      const user = userCredential.user;

      
      await setDoc(doc(db, "users", user.uid), {
        fullName: fullName,
        email: email, 
        createdAt: new Date().toISOString(),
      });

     
      await sendEmailVerification(user);

      setIsLoading(false);
      setEmailSent(true);
      alert("Verification email sent! Please check your inbox.");

     
      setEmail("");
      setPassword("");
      setFullName("");

    
      setTimeout(() => {
        router.push("screens/login");
      }, 2000);
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
                <Text
                  style={{
                    color: "green",
                    marginBottom: 10,
                    textAlign: "center",
                  }}
                >
                  Verification email sent! Please check your inbox.
                  Redirecting...
                </Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  background: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 30,
  },
  logo: {
    width: 150,
    height: 150,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginTop: 10,
  },
  form: {
    width: "100%",
    marginBottom: 20,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 25,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 15,
    fontSize: 15,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  buttonShadow: {
    width: "80%",
    borderRadius: 30,
    elevation: 8,
    marginBottom: 20,
    shadowColor: "#3EADCF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  button: {
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: "#FFF",
    fontWeight: "bold",
    fontSize: 16,
    letterSpacing: 1.2,
  },
  footer: {
    flexDirection: "row",
    marginTop: 10,
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
