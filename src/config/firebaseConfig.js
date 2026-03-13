import Constants from 'expo-constants';

// Firebase configuration loaded from environment variables (set in app.config.js via .env)
const firebaseConfig = {
  apiKey: Constants.expoConfig?.extra?.firebaseApiKey,
  authDomain: Constants.expoConfig?.extra?.firebaseAuthDomain,
  projectId: Constants.expoConfig?.extra?.firebaseProjectId,
  storageBucket: Constants.expoConfig?.extra?.firebaseStorageBucket,
  messagingSenderId: Constants.expoConfig?.extra?.firebaseMessagingSenderId,
  appId: Constants.expoConfig?.extra?.firebaseAppId,
  measurementId: Constants.expoConfig?.extra?.firebaseMeasurementId,
};

if (!firebaseConfig.apiKey) {
  console.warn('Firebase config missing — set FIREBASE_API_KEY and other vars in .env');
}

export default firebaseConfig; 