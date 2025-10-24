import { collection, doc, updateDoc } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import { getDocs } from '../services/ReadTracking/TrackedFirestore';

export const addCoinsToAllUsers = async () => {
  try {
    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);
    
    const updatePromises = snapshot.docs.map(async userDoc => {
      const userRef = doc(db, 'users', userDoc.id);
      const userData = userDoc.data();
      
      // Get all groups the user is a member of
      const groupsRef = collection(db, 'groups');
      const groupsSnapshot = await getDocs(groupsRef);
      
      // Create an object with all group balances
      const groupBalances = {};
      groupsSnapshot.docs.forEach(groupDoc => {
        if (groupDoc.data().members?.includes(userDoc.id)) {
          groupBalances[groupDoc.id] = 100;
        }
      });
      
      // Update the user document with new group balances
      return updateDoc(userRef, {
        groupBalances
      });
    });

    await Promise.all(updatePromises);
    console.log('Successfully added coins to all users');
    return true;
  } catch (error) {
    console.error('Error adding coins to users:', error);
    return false;
  }
};

export const addCoinsToUser = async (userId, amount = 100) => {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    const userData = userDoc.data();
    
    // Get all groups the user is a member of
    const groupsRef = collection(db, 'groups');
    const groupsSnapshot = await getDocs(groupsRef);
    
    // Create an object with all group balances
    const groupBalances = {};
    groupsSnapshot.docs.forEach(groupDoc => {
      if (groupDoc.data().members?.includes(userId)) {
        groupBalances[groupDoc.id] = amount;
      }
    });
    
    await updateDoc(userRef, {
      groupBalances
    });
    return true;
  } catch (error) {
    console.error('Error adding coins to user:', error);
    return false;
  }
};

export const makeUserAdmin = async (userId) => {
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      role: 'admin'
    });
    console.log('Successfully made user an admin');
    return true;
  } catch (error) {
    console.error('Error making user admin:', error);
    return false;
  }
}; 