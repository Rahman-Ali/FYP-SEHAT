
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#0D47A1", 
          borderTopColor: "#0D47A1",
          height: 60,
          paddingBottom: 5,
        },
        tabBarActiveTintColor: "#00BCD4", 
        tabBarInactiveTintColor: "#FFFFFF",
        tabBarShowLabel: false,
      }}
    >
      {/* Home */}
      <Tabs.Screen
        name="home"
        options={{
          tabBarIcon: ({ focused }) => (
            <MaterialCommunityIcons
              name="home"
              size={28}
              color={focused ? "#00BCD4" : "#FFFFFF"}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="chatbot"
        options={{
          tabBarIcon: ({ focused }) => (
            <MaterialCommunityIcons
              name="robot"
              size={28}
              color={focused ? "#00BCD4" : "#FFFFFF"}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="library"
        options={{
          tabBarIcon: ({ focused }) => (
            <MaterialCommunityIcons
              name="library"
              size={28}
              color={focused ? "#00BCD4" : "#FFFFFF"}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ focused }) => (
            <MaterialCommunityIcons
              name="account"
              size={28}
              color={focused ? "#00BCD4" : "#FFFFFF"}
            />
          ),
        }}
      />
    </Tabs>
  );
}
