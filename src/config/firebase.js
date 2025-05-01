import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import config from './firebaseConfig';

const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Optionally initialize analytics only if supported:
// import { getAnalytics, isSupported } from 'firebase/analytics';
// isSupported().then(supported => { if (supported) getAnalytics(app); });
