import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../config/firebase';

export const updateShowcase = async (userId, showcase) => {
  try {
    const userProfileRef = doc(db, 'userProfiles', userId);
    await updateDoc(userProfileRef, {
      showcase,
      'stats.lastUpdated': new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('Error updating showcase:', error);
    throw error;
  }
};

export const updateProfileStats = async (userId, statsUpdate) => {
  try {
    const userProfileRef = doc(db, 'userProfiles', userId);
    await updateDoc(userProfileRef, {
      ...Object.entries(statsUpdate).reduce((acc, [key, value]) => ({
        ...acc,
        [`stats.${key}`]: value
      }), {}),
      'stats.lastUpdated': new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('Error updating profile stats:', error);
    throw error;
  }
};
