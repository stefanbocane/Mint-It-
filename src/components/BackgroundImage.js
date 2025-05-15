import React from 'react';
import { ImageBackground, StyleSheet } from 'react-native';

/**
 * BackgroundImage component that renders the app's background image
 * Simple implementation to avoid animation issues
 */
const BackgroundImage = React.memo(({ children, style }) => {
  const backgroundStyle = StyleSheet.flatten([styles.background, style]);
  
  return (
    <ImageBackground 
      source={require('../assets/Falling Coin BG.png')} 
      style={backgroundStyle}
      resizeMode="cover"
      imageStyle={styles.imageStyle}
    >
      {children}
    </ImageBackground>
  );
});

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