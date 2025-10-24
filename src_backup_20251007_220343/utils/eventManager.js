import { NativeEventEmitter, NativeModules } from 'react-native';

// Create a dummy native module to use with NativeEventEmitter
// This is a workaround since we don't need an actual native module
const dummyNativeModule = NativeModules.EventEmitter || {};

// Create a singleton event emitter
const eventEmitter = new NativeEventEmitter(dummyNativeModule);

/**
 * App-wide event manager that works in React Native
 */
const EventManager = {
  /**
   * Subscribe to an event
   * @param {string} eventName - The name of the event to listen for
   * @param {Function} handler - The callback function
   * @returns {Object} - Subscription that should be removed when no longer needed
   */
  subscribe: (eventName, handler) => {
    return eventEmitter.addListener(eventName, handler);
  },

  /**
   * Emit an event
   * @param {string} eventName - The name of the event to emit
   * @param {Object} data - The data to pass to listeners
   */
  emit: (eventName, data) => {
    eventEmitter.emit(eventName, data);
  },

  /**
   * Remove a specific subscription
   * @param {Object} subscription - The subscription returned from subscribe()
   */
  unsubscribe: (subscription) => {
    if (subscription && typeof subscription.remove === 'function') {
      subscription.remove();
    }
  },

  /**
   * Remove all listeners for a specific event
   * @param {string} eventName - The name of the event
   */
  removeAllListeners: (eventName) => {
    eventEmitter.removeAllListeners(eventName);
  }
};

export default EventManager; 