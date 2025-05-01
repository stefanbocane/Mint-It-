import * as Notifications from 'expo-notifications';
import { doc, setDoc } from 'firebase/firestore';
import { Platform } from 'react-native';
import { db } from './firebase';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export const setupNotifications = async (userId) => {
  try {
    // Request notification permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      console.log('Failed to get push token for push notification!');
      return;
    }

    // Get Expo push token
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    
    // Save token to Firestore
    await setDoc(doc(db, 'users', userId), {
      expoPushToken: token,
    }, { merge: true });

    // Handle notification when app is in foreground
    Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received in foreground:', notification);
    });

    // Handle notification when app is in background
    Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification response received:', response);
    });

  } catch (error) {
    console.error('Error setting up notifications:', error);
  }
}; 