import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Image, PixelRatio, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PIXEL_RATIO = PixelRatio.get();

/**
 * EnhancedCardImage - A robust image component for card display
 * Handles consistent sizing, loading states, and error recovery
 * Fixed to work consistently across different devices
 */
const EnhancedCardImage = ({
  imageUrl,
  style,
  resizeMode = 'cover',
  rarityColor = '#666',
  aspectRatio = 0.7,
  onLoad,
  onError,
  placeholder = 'No Image Available',
  retryEnabled = true,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [processedUrl, setProcessedUrl] = useState(null);
  
  const maxRetries = 2;

  // Calculate consistent dimensions that work on all devices
  const cardDimensions = useCallback(() => {
    // If style provides width and height, use those (for preview modal)
    if (style?.width && style?.height) {
      return { width: style.width, height: style.height };
    }
    
    // Calculate base dimensions for grid
    const padding = 16; // Total padding for screen margins
    const cardMargin = 8; // Margin between cards
    const totalHorizontalSpace = padding + cardMargin;
    
    // Account for device pixel ratio for consistent rendering
    const effectiveScreenWidth = SCREEN_WIDTH / PIXEL_RATIO * PIXEL_RATIO;
    const baseWidth = Math.floor((effectiveScreenWidth - totalHorizontalSpace) / 2);
    const baseHeight = Math.floor(baseWidth / aspectRatio);
    
    return { 
      width: baseWidth, 
      height: baseHeight 
    };
  }, [aspectRatio, style]);

  // Process and validate image URL
  const processImageUrl = useCallback((url) => {
    if (!url || typeof url !== 'string') {
      return null;
    }

    const trimmedUrl = url.trim();
    
    // Basic URL validation
    if (!trimmedUrl.startsWith('http')) {
      console.warn('EnhancedCardImage: Invalid URL format:', trimmedUrl);
      return null;
    }

    // Process Firebase Storage URLs to ensure proper format
    if (trimmedUrl.includes('firebasestorage.googleapis.com')) {
      if (trimmedUrl.includes('alt=media')) {
        return trimmedUrl;
      }
      
      // Try to construct proper Firebase Storage URL
      const match = trimmedUrl.match(/\/o\/([^?]+)/);
      if (match && match[1]) {
        const filePath = decodeURIComponent(match[1]);
        return `https://firebasestorage.googleapis.com/v0/b/cardmates-bca66.appspot.com/o/${encodeURIComponent(filePath)}?alt=media`;
      }
    }

    return trimmedUrl;
  }, []);

  // Initialize and process URL
  useEffect(() => {
    const url = processImageUrl(imageUrl);
    console.log('EnhancedCardImage: Processing URL', { original: imageUrl, processed: url });
    
    setProcessedUrl(url);
    setError(!url);
    // Only set loading to true if we have a valid URL and we're not already in an error state
    if (url) {
      setLoading(true);
      setError(false);
    } else {
      setLoading(false);
      setError(true);
    }
    setRetryCount(0); // Reset retry count when URL changes
  }, [imageUrl, processImageUrl]);

  // Add a timeout fallback for stuck loading states
  useEffect(() => {
    if (loading && processedUrl) {
      const timeout = setTimeout(() => {
        console.warn('EnhancedCardImage: Image load timeout, forcing error state', { url: processedUrl });
        setLoading(false);
        setError(true);
      }, 10000); // 10 second timeout

      return () => clearTimeout(timeout);
    }
  }, [loading, processedUrl]);

  // Handle image load start
  const handleLoadStart = useCallback(() => {
    console.log('EnhancedCardImage: Load start', { url: processedUrl });
    if (processedUrl) {
      setLoading(true);
      setError(false);
    }
  }, [processedUrl]);

  // Handle successful image load
  const handleImageLoad = useCallback((event) => {
    console.log('EnhancedCardImage: Load success', { url: processedUrl, event: event?.nativeEvent });
    // Always set loading to false when we get a load event
    setLoading(false);
    setError(false);
    onLoad?.(event);
  }, [onLoad, processedUrl]);

  // Handle image load error
  const handleImageError = useCallback((event) => {
    console.warn('EnhancedCardImage: Load error', { url: processedUrl, event: event?.nativeEvent });
    setLoading(false);
    setError(true);
    onError?.(event);
  }, [processedUrl, retryCount, onError]);

  // Handle retry
  const handleRetry = useCallback(() => {
    if (retryCount >= maxRetries || !retryEnabled) {
      return;
    }
    
    setRetryCount(prev => prev + 1);
    setError(false);
    setLoading(true);
    
    // Force image reload by adding cache buster
    const currentUrl = processedUrl;
    if (currentUrl) {
      const separator = currentUrl.includes('?') ? '&' : '?';
      const newUrl = `${currentUrl}${separator}_retry=${Date.now()}`;
      setProcessedUrl(newUrl);
    }
  }, [retryCount, maxRetries, retryEnabled, processedUrl]);

  const dimensions = cardDimensions();
  const containerStyle = [
    {
      width: dimensions.width,
      height: dimensions.height,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: '#f5f5f5',
      justifyContent: 'center',
      alignItems: 'center',
      position: 'relative',
    },
    style
  ];

  // Error state
  if (error || !processedUrl) {
    return (
      <View style={containerStyle}>
        <Icon 
          name="image-broken-variant" 
          size={30} 
          color="#999" 
        />
        <Text style={{
          color: '#666',
          fontSize: 12,
          marginTop: 8,
          textAlign: 'center',
          paddingHorizontal: 8,
        }}>
          {placeholder}
        </Text>
        {retryEnabled && retryCount < maxRetries && (
          <Text 
            style={{
              color: rarityColor,
              fontSize: 10,
              marginTop: 4,
              textDecorationLine: 'underline',
            }}
            onPress={handleRetry}
          >
            Tap to retry
          </Text>
        )}
      </View>
    );
  }

  // Loading state
  if (loading) {
    return (
      <View style={containerStyle}>
        <ActivityIndicator 
          size="small" 
          color={rarityColor} 
        />
        <Text style={{
          color: '#666',
          fontSize: 12,
          marginTop: 8,
          textAlign: 'center',
        }}>
          Loading...
        </Text>
      </View>
    );
  }

  // Render image
  return (
    <View style={containerStyle}>
      <Image
        source={{ 
          uri: processedUrl,
          cache: 'force-cache'
        }}
        style={{
          width: dimensions.width,
          height: dimensions.height,
          borderRadius: 16,
        }}
        resizeMode={resizeMode}
        onLoadStart={handleLoadStart}
        onLoad={handleImageLoad}
        onError={handleImageError}
        fadeDuration={200}
        key={`image-${processedUrl}-${retryCount}`}
      />
    </View>
  );
};

export default EnhancedCardImage; 