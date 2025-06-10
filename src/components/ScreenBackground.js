import React from 'react';
import { StyleSheet, View } from 'react-native';
import BackgroundImage from './BackgroundImage';

/**
 * A wrapper component that provides consistent background image for all screens
 */
const ScreenBackground = ({ style, children }) => {
  // Helper method to validate React children
  const validateReactChildren = (children) => {
    if (!children) return null;

    if (Array.isArray(children)) {
      return children.filter(child => 
        child === null || 
        child === undefined || 
        typeof child === 'string' || 
        typeof child === 'number' || 
        React.isValidElement(child)
      );
    }

    if (React.isValidElement(children) || 
        typeof children === 'string' || 
        typeof children === 'number') {
      return children;
    }
    
    return null; // Reject non-element objects
  };

  // Get props safely
  const userStyle = style || {};

  // Calculate style safely
  let contentStyle;
  try {
    const baseStyle = [styles.content];
    
    // Add user styles without any safe area padding
    // The TabNavigator already handles safe area insets
    if (userStyle) {
      if (Array.isArray(userStyle)) {
        baseStyle.push(...userStyle);
      } else if (typeof userStyle === 'object') {
        baseStyle.push(userStyle);
      }
    }
    
    contentStyle = StyleSheet.flatten(baseStyle);
  } catch (e) {
    console.warn('Error processing styles:', e);
    contentStyle = styles.content;
  }

  // Prepare safe children
  const safeChildren = validateReactChildren(children);

  return (
    <BackgroundImage style={styles.container}>
      {/* Main content */}
      <View style={contentStyle}>
        {safeChildren}
      </View>
    </BackgroundImage>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});

export default ScreenBackground; 