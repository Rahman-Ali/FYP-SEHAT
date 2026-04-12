import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import { useEffect, useState } from "react";
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
import { auth } from "../../firebase.config";

export default function Login() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState(null);

  
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true); 

  
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
       
        
        if (user.emailVerified) {
          console.log("User already logged in, redirecting...");
          router.replace("/screens/(tabs)/home"); 
        } else {
          
          
          setIsCheckingSession(false);
        }
      } else {
        
        
        setIsCheckingSession(false);
      }
    });

    return () => unsubscribe(); 
  }, []);

  const handleInputChange = (setter) => (value) => {
    setter(value);
    if (errorMessage) setErrorMessage(null);
  };

  const handleLogin = () => {
    setErrorMessage(null);

    if (!email || !password) {
      setErrorMessage("Email and password are required");
      return;
    }

    setIsLoading(true); 

    signInWithEmailAndPassword(auth, email, password)
      .then((userCredential) => {
        const user = userCredential.user;

        if (!user.emailVerified) {
          setIsLoading(false); 
          
          Alert.alert(
            "Email Not Verified",
            "Please verify your email before logging in.",
            [{ text: "OK" }],
          );
          return;
        }

        console.log("User logged in:", user);
        
        
        router.replace("/screens/(tabs)/home");
      })
      .catch((error) => {
        setIsLoading(false); 
        if (error.code === "auth/user-not-found") {
          setErrorMessage("No account found with this email");
        } else if (error.code === "auth/wrong-password") {
          setErrorMessage("Incorrect password");
        } else {
          setErrorMessage(error.message || "Login failed. Try again.");
        }
      });
  };

  const handleNext = () => {
    router.push("screens/forgetPassword");
  };

  
  if (isCheckingSession) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3EADCF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar
        barStyle="dark-content"
        translucent
        backgroundColor="transparent"
      />

      <ImageBackground
        source={require("../../assets/images/bg.png")}
        style={styles.background}
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
              {/* Logo */}
              <View style={styles.logoContainer}>
                <Image
                  source={require("../../assets/images/sehat_logo.png")}
                  style={styles.logo}
                  resizeMode="contain"
                />
                <Text style={styles.title}>Welcome Back</Text>
                <Text style={styles.subtitle}>Login in to continue</Text>
              </View>

              {/* Form */}
              <View style={styles.form}>
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

              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.buttonShadow}
                onPress={handleLogin}
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
                    <Text style={styles.buttonText}>LOGIN</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              <View style={styles.footer}>
                <TouchableOpacity onPress={handleNext}>
                  <Text style={styles.signupText}>Forget Password?</Text>
                </TouchableOpacity>
              </View>


              <View style={styles.signupContainer}>
                <Text style={styles.footerText}>Don't have an account? </Text>
                <TouchableOpacity onPress={() => router.push("screens/signup")}>
                  <Text style={styles.signupText}>Sign Up</Text>
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
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
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
    paddingTop: 40,
    paddingBottom: 20,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 40,
  },
  logo: {
    width: 180,
    height: 180,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginTop: 10,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 5,
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
    marginBottom: 20,
  },
  signupContainer: {
    flexDirection: "row",
    marginTop: 10,
  },
  footerText: {
    color: "#555",
    fontSize: 14,
  },
  signupText: {
    color: "#3EADCF",
    fontWeight: "bold",
    fontSize: 14,
  },
});
