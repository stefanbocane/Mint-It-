import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaConsumer } from 'react-native-safe-area-context';
import BackgroundImage from './BackgroundImage';

/**
 * A wrapper component that provides consistent background image for all screens
 * Using React.memo for better performance
 */
const ScreenBackground = React.memo(({ children, style }) => {
  return (
    <SafeAreaConsumer>
      {insets => {
        // Pre-calculate styles for better performance
        const fixedContentStyle = StyleSheet.flatten([
          styles.content,
          { paddingTop: insets.top },
          style
        ]);
        
        return (
          <BackgroundImage style={styles.container}>
            <View style={fixedContentStyle}>
              {children}
            </View>
          </BackgroundImage>
        );
      }}
    </SafeAreaConsumer>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});

export default ScreenBackground; 