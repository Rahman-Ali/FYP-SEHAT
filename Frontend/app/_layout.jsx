import { Stack } from "expo-router";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function _layout() {
  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="screens/service1" />
        <Stack.Screen name="screens/service2" />
        <Stack.Screen name="screens/service3" />
        <Stack.Screen name="screens/service4" />
        <Stack.Screen name="screens/login" />
        <Stack.Screen name="screens/signup" />
        <Stack.Screen name="screens/forgetPassword" />
      </Stack>
    </SafeAreaProvider>
  );
}
