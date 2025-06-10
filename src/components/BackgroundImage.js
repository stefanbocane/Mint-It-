import React from 'react';
import { ImageBackground, StyleSheet, Text, View } from 'react-native';

/**
 * BackgroundImage - Functional component implementation with safe children handling
 */
const BackgroundImage = ({ children, style }) => {
  /**
   * Sanitize children to ensure no invalid objects are passed as React children
   */
  const getSafeChildren = () => {
    // Return null for undefined/null children
    if (!children) return null;

    // For arrays, recursively sanitize each child
    if (Array.isArray(children)) {
      return children
        .filter(child => 
          child === null || 
          child === undefined || 
          typeof child === 'string' || 
          typeof child === 'number' || 
          React.isValidElement(child)
        )
        .map((child, index) => {
          // Generate a more unique key to prevent duplicates
          const uniqueKey = `bg-child-${index}-${typeof child}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          
          if (React.isValidElement(child)) {
            // Use existing key if available, otherwise use our unique key
            const childKey = child.key || uniqueKey;
            return React.cloneElement(child, { key: childKey });
          } else if (typeof child === 'string' || typeof child === 'number') {
            // Wrap string/number in <Text>
            return <Text key={uniqueKey}>{child}</Text>;
          }
          return child;
        });
    }

    // For valid elements, return as-is
    if (React.isValidElement(children)) {
      return children;
    }
    // For primitives, wrap in <Text>
    if (typeof children === 'string' || typeof children === 'number') {
      return <Text>{children}</Text>;
    }

    // For anything else (like objects that aren't React elements), return null
    // This is the case that prevents {padding, paddingBottom} from being treated as children
    return null;
  };

  /**
   * Get valid style object
   */
  const getSafeStyle = () => {
    try {
      // Default style
      if (!style) return styles.background;

      // Handle array styles
      if (Array.isArray(style)) {
        return StyleSheet.flatten([styles.background, ...style]);
      }
      
      // Handle object styles
      if (typeof style === 'object' && style !== null) {
        return StyleSheet.flatten([styles.background, style]);
      }
      
      // Fallback
      return styles.background;
    } catch (e) {
      console.warn('Style error in BackgroundImage:', e);
      return styles.background;
    }
  };

  // Prepare safe styles and children
  const backgroundStyle = getSafeStyle();
  const safeChildren = getSafeChildren();

  return (
    <ImageBackground
      source={require('../assets/Falling Coin BG.png')}
      style={backgroundStyle}
      resizeMode="cover"
      imageStyle={styles.imageStyle}
    >
      <View style={{ flex: 1 }}>
        {safeChildren}
      </View>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  background: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  imageStyle: {
    resizeMode: 'cover',
  }
});

export default BackgroundImage; 