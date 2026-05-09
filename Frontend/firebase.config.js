// firebase.config.js
import { initializeApp } from "firebase/app";
import {
  initializeAuth,
  getReactNativePersistence,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFirestore, doc, onSnapshot, getDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDUxP_4D8O0Ul1ikWDLLb_m8Ii0DLBWON8",
  authDomain: "sehat-538ee.firebaseapp.com",
  projectId: "sehat-538ee",
  storageBucket: "sehat-538ee.firebasestorage.app",
  messagingSenderId: "578328182344",
  appId: "1:578328182344:web:0e0e0e0e0e0e0e0e0e0e0"
};

const app = initializeApp(firebaseConfig);

// ✅ Auth with native AsyncStorage persistence
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage)
});

export const db = getFirestore(app);

// ─── Role cache & helpers (unchanged) ──────────────────────────
const roleCache = {};

export const getUserRole = async (uid, forceRefresh = false) => {
  try {
    if (!uid) return "user";
    if (!forceRefresh && roleCache[uid]) {
      return roleCache[uid].role;
    }
    const userDocRef = doc(db, "users", uid);
    const userDocSnap = await getDoc(userDocRef);
    if (userDocSnap.exists()) {
      const role = userDocSnap.data().role || "user";
      roleCache[uid] = { role, timestamp: Date.now() };
      return role;
    }
    return "user";
  } catch (error) {
    console.error("[getUserRole] Error:", error.message);
    return "user";
  }
};

export const onRoleChange = (uid, callback) => {
  if (!uid) return () => {};
  const userDocRef = doc(db, "users", uid);
  const unsubscribe = onSnapshot(
    userDocRef,
    (docSnap) => {
      if (docSnap.exists()) {
        const newRole = docSnap.data().role || "user";
        const oldRole = roleCache[uid]?.role || null;
        roleCache[uid] = { role: newRole, timestamp: Date.now() };
        if (oldRole && newRole !== oldRole) {
          callback(newRole, oldRole);
        }
      }
    },
    (error) => console.error("[onRoleChange] Error:", error.message)
  );
  return unsubscribe;
};

export const clearRoleCache = (uid) => {
  if (uid) delete roleCache[uid];
};

export default app;