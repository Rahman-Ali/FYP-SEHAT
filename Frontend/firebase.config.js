import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";


const firebaseConfig = {
  apiKey: "AIzaSyDUxP_4D8O0Ul1ikWDLLb_m8Ii0DLBWON8",
  authDomain: "sehat-538ee.firebaseapp.com",
  projectId: "sehat-538ee",
  storageBucket: "sehat-538ee.firebasestorage.app",
  messagingSenderId: "317973795124",
  appId: "1:317973795124:web:f37c0db6d7d2204f5b1561"
};


const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);