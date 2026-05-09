// app/_layout.jsx
import { Stack, useRouter, useSegments } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth, onRoleChange, getUserRole } from "../firebase.config";

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  
  // 🎯 Track all listeners for proper cleanup
  const roleUnsubscribeRef = useRef(null);
  const authUnsubscribeRef = useRef(null);
  
  const [initialized, setInitialized] = useState(false);

  // 🎯 Initial route guard (ONE-TIME CHECK)
  useEffect(() => {
    const checkAuthAndRedirect = async () => {
      try {
        const hasCompleted = await AsyncStorage.getItem("hasCompletedRegistration");
        const isRegistered = hasCompleted === "true";

        if (!isRegistered) {
          if (segments[0] !== "screens" || segments[1] !== "service1") {
            router.replace("/screens/service1");
          }
          setInitialized(true);
          return;
        }

        const user = auth.currentUser;

        if (user && user.emailVerified) {
          try {
            const role = await getUserRole(user.uid);
            if (role === "admin") {
              router.replace("/screens/admin/AdminDashboard");
            } else {
              router.replace("/screens/(tabs)/home");
            }
          } catch (err) {
            router.replace("/screens/(tabs)/home");
          }
        } else {
          if (segments[0] !== "screens" || segments[1] !== "login") {
            router.replace("/screens/login");
          }
        }
      } catch (e) {
        console.error("RootLayout init error:", e);
        router.replace("/screens/login");
      } finally {
        setInitialized(true);
      }
    };

    checkAuthAndRedirect();
  }, []);

  // 🎯 Auth state + Role listener (PROPERLY CLEANED)
  useEffect(() => {
    const setupListeners = () => {
      // Cleanup previous role listener
      if (roleUnsubscribeRef.current) {
        roleUnsubscribeRef.current();
        roleUnsubscribeRef.current = null;
      }

      const user = auth.currentUser;
      if (!user) return;

      // 🎯 Single role listener with proper cleanup
      roleUnsubscribeRef.current = onRoleChange(user.uid, (newRole, oldRole) => {
        Alert.alert(
          "Role Updated",
          `Your role changed from "${oldRole}" to "${newRole}". App will refresh.`,
          [{
            text: "OK",
            onPress: () => {
              if (newRole === "admin") {
                router.replace("/screens/admin/AdminDashboard");
              } else {
                router.replace("/screens/(tabs)/home");
              }
            }
          }]
        );
      });
    };

    // 🎯 Auth listener - stored for cleanup
    authUnsubscribeRef.current = auth.onAuthStateChanged((user) => {
      if (user) {
        setupListeners();
      } else {
        // User signed out - cleanup role listener
        if (roleUnsubscribeRef.current) {
          roleUnsubscribeRef.current();
          roleUnsubscribeRef.current = null;
        }
      }
    });

    // Initial setup if user already logged in
    if (auth.currentUser) {
      setupListeners();
    }

    // 🎯 Complete cleanup on unmount
    return () => {
      if (authUnsubscribeRef.current) {
        authUnsubscribeRef.current();
        authUnsubscribeRef.current = null;
      }
      if (roleUnsubscribeRef.current) {
        roleUnsubscribeRef.current();
        roleUnsubscribeRef.current = null;
      }
    };
  }, []);

  if (!initialized) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="screens/login" />
        <Stack.Screen name="screens/signup" />
        <Stack.Screen name="screens/forgetPassword" />
        <Stack.Screen name="screens/service1" />
        <Stack.Screen name="screens/service2" />
        <Stack.Screen name="screens/service3" />
        <Stack.Screen name="screens/service4" />
        <Stack.Screen name="screens/admin/AdminDashboard" />
        <Stack.Screen name="screens/(tabs)" />
      </Stack>
    </SafeAreaProvider>
  );
}