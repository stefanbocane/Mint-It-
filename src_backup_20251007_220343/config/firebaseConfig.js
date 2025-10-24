import Constants from 'expo-constants';

// Your web app's Firebase configuration using environment variables for security
const firebaseConfig = {
  apiKey: Constants.expoConfig?.extra?.firebaseApiKey || "REDACTED_FIREBASE_API_KEY",
  authDomain: Constants.expoConfig?.extra?.firebaseAuthDomain || "cardmates-bca66.firebaseapp.com",
  projectId: Constants.expoConfig?.extra?.firebaseProjectId || "cardmates-bca66",
  storageBucket: Constants.expoConfig?.extra?.firebaseStorageBucket || "cardmates-bca66.firebasestorage.app",
  messagingSenderId: Constants.expoConfig?.extra?.firebaseMessagingSenderId || "37257408298",
  appId: Constants.expoConfig?.extra?.firebaseAppId || "1:37257408298:web:6665c30d84f2f78d8af853",
  measurementId: Constants.expoConfig?.extra?.firebaseMeasurementId || "G-8VTS46M32H"
};

export default firebaseConfig; 