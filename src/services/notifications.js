import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { Platform } from 'react-native';
import { db } from '../config/firebase';

// Constants
const NOTIFICATION_CHANNEL_ID = 'card-app-notifications';
const NOTIFICATION_SETTINGS_KEY = '@notification_settings';

// Default notification settings
const DEFAULT_SETTINGS = {
  auctionEnding: true,
  newBid: true,
  auctionWon: true,
  auctionLost: true,
  tradeOffer: true,
  tradeAccepted: true,
  enabled: true,
};

// Configure notifications handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Registers the device for push notifications and saves the token to Firestore
 * @param {string} userId - The user's ID to associate with the token
 * @returns {Promise<string|null>} - The push token or null if registration failed
 */
export const registerForPushNotificationsAsync = async (userId) => {
  let token = null;
  
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  // Set up notification channel for Android
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#9B5DE5', // Match app theme color
    });
  }

  // Request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  if (finalStatus !== 'granted') {
    console.log('Failed to get push token for push notification!');
    return null;
  }
  
  // Get the token
  try {
    token = (await Notifications.getExpoPushTokenAsync({
      projectId: undefined, // Use the default project if undefined
    })).data;
    
    console.log('Push notification token:', token);
    
    // Save the token to Firestore
    if (userId) {
      await setDoc(doc(db, 'users', userId), {
        expoPushToken: token,
        lastTokenUpdate: new Date().toISOString()
      }, { merge: true });
    }
  } catch (error) {
    console.error('Error getting push token:', error);
  }

  return token;
};

/**
 * Sets up notification listeners for the app
 * @returns {Promise<Function>} - A cleanup function to remove the listeners
 */
export const setupNotificationListeners = async () => {
  try {
    console.log('Setting up notification listeners');
    
    // When a notification is received while the app is in the foreground
    const receivedSubscription = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received in foreground:', notification);
    });

    // When the user interacts with a notification (e.g., taps on it)
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification response received:', response);
    });

    // Return cleanup function using the subscription's remove method
    return () => {
      console.log('Cleaning up notification listeners');
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  } catch (error) {
    console.error('Error setting up notification listeners:', error);
    return () => {}; // Return empty cleanup function if setup failed
  }
};

/**
 * Send a push notification to a specific device
 * @param {string} expoPushToken - The Expo push token to send to
 * @param {string} title - The notification title
 * @param {string} body - The notification body
 * @param {Object} data - Additional data to include with the notification
 * @returns {Promise<void>}
 */
export const sendPushNotification = async (expoPushToken, title, body, data = {}) => {
  const message = {
    to: expoPushToken,
    sound: 'default',
    title,
    body,
    data,
  };

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });
};

/**
 * Schedule a local notification to be shown immediately
 * @param {string} title - The notification title
 * @param {string} body - The notification body
 * @param {Object} data - Additional data to include
 * @returns {Promise<void>}
 */
export const scheduleNotification = async (title, body, data = {}) => {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
    },
    trigger: null, // Send immediately
  });
};

/**
 * Send a push notification to all users in a group
 * @param {string} groupId - The ID of the group to send notifications to
 * @param {string} title - The notification title
 * @param {string} body - The notification body
 * @param {Object} data - Additional data to include with the notification
 * @param {string[]} excludeUserIds - Array of user IDs to exclude from receiving the notification
 * @returns {Promise<number>} - Number of notifications sent
 */
export const sendGroupNotification = async (groupId, title, body, data = {}, excludeUserIds = []) => {
  try {
    // Get all users in the group
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('groups', 'array-contains', groupId));
    const querySnapshot = await getDocs(q);
    
    let sentCount = 0;

    // Send notification to each user with a push token
    const sendPromises = querySnapshot.docs
      .filter(doc => !excludeUserIds.includes(doc.id) && doc.data().expoPushToken)
      .map(async (userDoc) => {
        const userData = userDoc.data();
        const { expoPushToken } = userData;
        
        if (expoPushToken) {
          await sendPushNotification(expoPushToken, title, body, data);
          sentCount++;
        }
      });

    await Promise.all(sendPromises);
    
    return sentCount;
  } catch (error) {
    console.error('Error sending group notification:', error);
    return 0;
  }
};

/**
 * Send a notification when a user coins a card
 * @param {string} groupId - The group ID
 * @param {string} userId - The user ID who coined the card
 * @param {string} username - The username who coined the card
 * @param {string} cardName - The name of the card that was coined
 * @returns {Promise<number>} - Number of notifications sent
 */
export const sendCardCoinedNotification = async (groupId, userId, username, cardName) => {
  const title = 'New Card Coined!';
  const body = `${username} just coined ${cardName}.`;
  const data = { 
    type: 'card_coined',
    groupId,
    userId,
    cardName
  };
  
  return sendGroupNotification(groupId, title, body, data, [userId]);
};

/**
 * Initialize and configure notifications
 */
export const initNotifications = async () => {
  if (!Device.isDevice) {
    // Don't set up for simulators/emulators
    console.log('Skipping notification setup on simulator/emulator');
    return null;
  }

  // Request permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Permission for notifications was denied');
    return null;
  }

  // Configure notification handling
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  // Set up notification categories/channels
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
      name: 'Card App Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4CAF50',
    });
  }

  // Get token
  const token = await registerForPushNotifications();
  return token;
};

/**
 * Register the device for push notifications
 * 
 * @returns {Promise<string|null>} Push token or null if not available
 */
export const registerForPushNotifications = async () => {
  let token;
  
  try {
    // Get the token
    token = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId,
    });
    
    console.log('Expo push token:', token);
    return token.data;
  } catch (error) {
    console.error('Failed to get push token:', error);
    return null;
  }
};

/**
 * Save the Expo push token to the user's profile
 * 
 * @param {string} userId - User ID
 * @param {string} token - Expo push token
 */
export const saveUserPushToken = async (userId, token) => {
  if (!userId || !token) return;
  
  try {
    const userRef = doc(db, 'users', userId);
    await setDoc(userRef, {
      expoPushToken: token,
      tokenUpdatedAt: new Date()
    });
    console.log('Push token saved to user profile');
  } catch (error) {
    console.error('Error saving push token:', error);
  }
};

/**
 * Schedule a local notification for auction ending soon
 * 
 * @param {string} userId - User ID
 * @param {string} auctionId - Auction ID
 * @param {string} cardName - Card name
 * @param {number} minutesRemaining - Minutes remaining
 * @param {string} expoPushToken - Expo push token (optional)
 * @returns {Promise<string|null>} Notification identifier or null
 */
export const sendAuctionEndingSoonNotification = async (
  userId,
  auctionId,
  cardName,
  minutesRemaining,
  expoPushToken = null
) => {
  try {
    // Check if notifications are enabled
    const settings = await getNotificationSettings();
    if (!settings.enabled || !settings.auctionEnding) {
      return null;
    }
    
    // Check if we've already sent this notification
    const notificationKey = `auction_ending_${auctionId}_${minutesRemaining}`;
    const alreadySent = await AsyncStorage.getItem(notificationKey);
    if (alreadySent) {
      return null;
    }
    
    const title = 'Auction Ending Soon';
    const body = `The auction for "${cardName}" will end in ${minutesRemaining} ${
      minutesRemaining === 1 ? 'minute' : 'minutes'
    }!`;
    
    // Schedule notification
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: {
          type: 'auction_ending',
          auctionId,
          cardName,
          minutesRemaining,
        },
      },
      trigger: null, // null means send immediately
    });
    
    // Mark as sent
    await AsyncStorage.setItem(notificationKey, 'sent');
    
    return notificationId;
  } catch (error) {
    console.error('Error scheduling auction ending notification:', error);
    return null;
  }
};

/**
 * Send notification when a user wins an auction
 * 
 * @param {string} userId - User ID
 * @param {string} auctionId - Auction ID
 * @param {string} cardName - Card name
 * @param {number} bidAmount - Winning bid amount
 * @returns {Promise<string|null>} Notification identifier or null
 */
export const sendAuctionWonNotification = async (
  userId,
  auctionId,
  cardName,
  bidAmount
) => {
  try {
    // Check if notifications are enabled
    const settings = await getNotificationSettings();
    if (!settings.enabled || !settings.auctionWon) {
      return null;
    }
    
    // Check if we've already sent this notification
    const notificationKey = `auction_won_${auctionId}`;
    const alreadySent = await AsyncStorage.getItem(notificationKey);
    if (alreadySent) {
      return null;
    }
    
    const title = 'Auction Won!';
    const body = `Congratulations! You won the auction for "${cardName}" with a bid of ${bidAmount} coins.`;
    
    // Schedule notification
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: {
          type: 'auction_won',
          auctionId,
          cardName,
          bidAmount,
        },
      },
      trigger: null, // null means send immediately
    });
    
    // Mark as sent
    await AsyncStorage.setItem(notificationKey, 'sent');
    
    return notificationId;
  } catch (error) {
    console.error('Error scheduling auction won notification:', error);
    return null;
  }
};

/**
 * Get user notification settings with defaults
 * 
 * @returns {Promise<Object>} Notification settings
 */
export const getNotificationSettings = async () => {
  try {
    const settingsString = await AsyncStorage.getItem(NOTIFICATION_SETTINGS_KEY);
    if (!settingsString) {
      return DEFAULT_SETTINGS;
    }
    
    const settings = JSON.parse(settingsString);
    // Merge with defaults to ensure all properties exist
    return { ...DEFAULT_SETTINGS, ...settings };
  } catch (error) {
    console.error('Error getting notification settings:', error);
    return DEFAULT_SETTINGS;
  }
};

/**
 * Save user notification settings
 * 
 * @param {Object} settings - Notification settings
 */
export const saveNotificationSettings = async (settings) => {
  try {
    const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
    await AsyncStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(mergedSettings));
    return true;
  } catch (error) {
    console.error('Error saving notification settings:', error);
    return false;
  }
};

/**
 * Toggle a specific notification setting
 * 
 * @param {string} settingKey - Setting key to toggle
 * @returns {Promise<Object>} Updated settings
 */
export const toggleNotificationSetting = async (settingKey) => {
  try {
    const settings = await getNotificationSettings();
    if (settingKey in settings) {
      settings[settingKey] = !settings[settingKey];
      await saveNotificationSettings(settings);
    }
    return settings;
  } catch (error) {
    console.error('Error toggling notification setting:', error);
    return null;
  }
};

/**
 * Send a notification for a trade offer
 * @param {string} receiverId - The ID of the user receiving the trade offer
 * @param {string} tradeId - The ID of the trade
 * @param {string} senderName - The name of the user sending the trade
 * @param {number} cardsOffered - Number of cards offered in the trade
 * @param {number} cardsRequested - Number of cards requested in the trade
 * @returns {Promise<boolean>} - Whether the notification was successfully sent
 */
export const sendTradeOfferNotification = async (
  receiverId,
  tradeId,
  senderName,
  cardsOffered,
  cardsRequested
) => {
  try {
    // Get the receiver's user data to find their push token
    const userRef = doc(db, 'users', receiverId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      console.log(`User ${receiverId} not found for trade notification`);
      return false;
    }
    
    const userData = userDoc.data();
    const expoPushToken = userData.expoPushToken;
    
    if (!expoPushToken) {
      console.log(`User ${receiverId} has no push token for trade notification`);
      return false;
    }
    
    // Get notification settings to check if user wants trade offer notifications
    const settings = await getNotificationSettings();
    if (!settings.enabled || !settings.tradeOffer) {
      console.log(`Trade offer notifications disabled for user ${receiverId}`);
      return false;
    }
    
    // Send the notification
    const title = 'New Trade Offer!';
    const body = `${senderName} has offered you a trade: ${cardsOffered} cards for ${cardsRequested} cards.`;
    const data = {
      type: 'trade_offer',
      tradeId,
      senderId: senderName,
    };
    
    await sendPushNotification(expoPushToken, title, body, data);
    console.log(`Trade offer notification sent to ${receiverId}`);
    return true;
  } catch (error) {
    console.error('Error sending trade offer notification:', error);
    return false;
  }
};

export default {
  initNotifications,
  registerForPushNotifications,
  saveUserPushToken,
  sendAuctionEndingSoonNotification,
  sendAuctionWonNotification,
  getNotificationSettings,
  saveNotificationSettings,
  toggleNotificationSetting,
  sendTradeOfferNotification
}; 