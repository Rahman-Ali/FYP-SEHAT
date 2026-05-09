// app/index.jsx - COMPLETELY REPLACE
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { auth, getUserRole } from '../firebase.config';

export default function Index() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuthAndRoute = async () => {
      try {
        const user = auth.currentUser;
        
        // CASE 1: User is logged in with verified email
        if (user && user.emailVerified) {
          const role = await getUserRole(user.uid, true);
          if (role === 'admin') {
            router.replace('/screens/admin/AdminDashboard');
          } else {
            router.replace('/screens/(tabs)/home');
          }
          setIsLoading(false);
          return;
        }
        
        // CASE 2: No active session - Check registration status
        const hasRegistered = await AsyncStorage.getItem("hasCompletedRegistration");
        
        if (hasRegistered === "true") {
          // User has registered before → Direct to Login
          router.replace('/screens/login');
        } else {
          // New user → Onboarding
          router.replace('/screens/service1');
        }
        
      } catch (error) {
        console.error('Routing error:', error);
        router.replace('/screens/service1');
      } finally {
        setIsLoading(false);
      }
    };

    // Check immediately (for already-loaded state)
    checkAuthAndRoute();

    // Also listen for auth state changes
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // This fires on every auth change
      // No need to re-route here as initial check handled it
    });

    return unsubscribe;
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D47A1' }}>
        <ActivityIndicator size="large" color="#00BCD4" />
        <Text style={{ color: '#FFF', marginTop: 12, fontSize: 16 }}>Loading SEHAT...</Text>
      </View>
    );
  }

  return null;
}