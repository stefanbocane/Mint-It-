import { getAnalytics } from "firebase/analytics";
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "REDACTED_FIREBASE_API_KEY",
  authDomain: "cardmates-bca66.firebaseapp.com",
  projectId: "cardmates-bca66",
  storageBucket: "cardmates-bca66.firebasestorage.app",
  messagingSenderId: "37257408298",
  appId: "1:37257408298:web:6665c30d84f2f78d8af853",
  measurementId: "G-8VTS46M32H"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const analytics = getAnalytics(app); 