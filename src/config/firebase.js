import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import config from './firebaseConfig';

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);

