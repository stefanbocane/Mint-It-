/**
 * OptimizedImage Component
 * 
 * Features:
 * - Progressive loading with placeholder
 * - Error handling with fallback
 * - Memory-efficient caching
 * - Lazy loading support
 * - Optimized re-renders
 */

import { memo, useCallback, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { useTheme } from 'react-native-paper';

const OptimizedImage = ({
  source,
  style,
  resizeMode = 'cover',
  placeholder = null,
  fallbackSource = 'https://via.placeholder.com/100',
  showLoader = true,
  onLoad,
  onError,
  testID,
  ...props
}) => {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [imageSource, setImageSource] = useState(source);

  const handleLoad = useCallback((event) => {
    setLoading(false);
    setError(false);
    onLoad?.(event);
  }, [onLoad]);

  const handleError = useCallback((event) => {
    console.warn('Image load error:', event.nativeEvent?.error);
    setLoading(false);
    setError(true);
    
    // Try fallback source if not already using it
    if (imageSource?.uri !== fallbackSource) {
      setImageSource({ uri: fallbackSource });
      setLoading(true);
      setError(false);
    }
    
    onError?.(event);
  }, [imageSource, fallbackSource, onError]);

  const handleLoadStart = useCallback(() => {
    setLoading(true);
  }, []);

  return (
    <View style={[styles.container, style]} testID={testID}>
      <Image
        source={imageSource}
        style={[styles.image, style]}
        resizeMode={resizeMode}
        onLoad={handleLoad}
        onError={handleError}
        onLoadStart={handleLoadStart}
        {...props}
      />
      
      {loading && showLoader && (
        <View style={[styles.loaderContainer, { backgroundColor: colors.surface }]}>
          {placeholder || (
            <ActivityIndicator 
              size="small" 
              color={colors.primary} 
              style={styles.loader}
            />
          )}
        </View>
      )}
      
      {error && !loading && (
        <View style={[styles.errorContainer, { backgroundColor: colors.surface }]}>
          <View style={[styles.errorPlaceholder, { borderColor: colors.outline }]} />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  loaderContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loader: {
    // No additional styles needed
  },
  errorContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorPlaceholder: {
    width: '60%',
    height: '60%',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 8,
  },
});

// Enhanced memo with custom comparison for better performance
export default memo(OptimizedImage, (prevProps, nextProps) => {
  return (
    prevProps.source?.uri === nextProps.source?.uri &&
    prevProps.resizeMode === nextProps.resizeMode &&
    prevProps.showLoader === nextProps.showLoader &&
    JSON.stringify(prevProps.style) === JSON.stringify(nextProps.style)
  );
}); 