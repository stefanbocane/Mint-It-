import { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Image, PixelRatio, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { BORDER_OPTIONS, getBorderAnimationStyle } from '../utils/borderOptions';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PIXEL_RATIO = PixelRatio.get();

/**
 * SimpleCardImage - A simplified, reliable image component for cards
 * Focuses on consistent sizing and reliable loading without complex logic
 * Now supports border effects globally
 */
const SimpleCardImage = ({
  imageUrl,
  style,
  resizeMode = 'cover',
  rarityColor = '#666',
  aspectRatio = 0.7,
  placeholder = 'No Image',
  borderType = 'default', // Add border type support
  card = null, // Full card object for border lookup
  retryEnabled = false,
  onLoad,
  onError
}) => {
  const [loading, setLoading] = useState(!!imageUrl);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 2;

  // Reset loading state when imageUrl changes
  useEffect(() => {
    if (imageUrl) {
      setLoading(true);
      setError(false);
      setRetryCount(0);
    } else {
      setLoading(false);
      setError(true);
    }
  }, [imageUrl]);

  // Get border style from card or borderType
  const getBorderStyle = () => {
    const effectiveBorderType = card?.borderType || borderType;
    if (!effectiveBorderType || effectiveBorderType === 'default') {
      return {};
    }

    const borderOption = BORDER_OPTIONS.find(b => b.id === effectiveBorderType);
    if (!borderOption) return {};

    return getBorderAnimationStyle(
      borderOption.animationType,
      borderOption.color,
      borderOption.secondaryColor,
      borderOption.glowIntensity
    );
  };

  // Calculate dimensions
  const calculateDimensions = () => {
    // FIRST: Check if explicit dimensions are provided in style prop
    if (style?.width && style?.height) {
      return { 
        width: typeof style.width === 'number' ? style.width : parseFloat(style.width) || 100,
        height: typeof style.height === 'number' ? style.height : parseFloat(style.height) || 150
      };
    }
    
    // Fallback to calculated dimensions for standalone use
    const padding = 16;
    const cardMargin = 8;
    const totalHorizontalSpace = padding + cardMargin;
    const effectiveScreenWidth = SCREEN_WIDTH / PIXEL_RATIO * PIXEL_RATIO;
    const baseWidth = Math.floor((effectiveScreenWidth - totalHorizontalSpace) / 2);
    const baseHeight = Math.floor(baseWidth / aspectRatio);
    
    return { width: baseWidth, height: baseHeight };
  };

  const dimensions = calculateDimensions();
  const borderStyle = getBorderStyle();
  
  // Apply border effects from style prop (passed from CardRenderer) or from getBorderStyle
  const effectiveBorderStyle = {
    ...borderStyle,
    ...(style || {})
  };
  
  const containerStyle = [
    {
      width: dimensions.width,
      height: dimensions.height,
      borderRadius: style?.borderRadius || 16,
      backgroundColor: '#f5f5f5',
      justifyContent: 'center',
      alignItems: 'center',
      position: 'relative',
      overflow: 'hidden', // Ensure image doesn't overflow container
    },
    effectiveBorderStyle // Apply border effects
  ];

  // Image should fill the container when explicit dimensions are provided
  const borderWidth = effectiveBorderStyle.borderWidth || 0;
  const imageInset = borderWidth > 0 ? Math.max(borderWidth + 1, 4) : 0;
  
  // If explicit dimensions are provided, fill the container completely
  const imageStyle = style?.width && style?.height ? {
    width: '100%',
    height: '100%',
    borderRadius: Math.max(0, (style?.borderRadius || 16) - 2),
  } : {
    width: dimensions.width - (imageInset * 2),
    height: dimensions.height - (imageInset * 2),
    borderRadius: Math.max(0, 16 - imageInset),
  };

  // Process image URL for Firebase Storage
  const processUrl = (url) => {
    if (!url || typeof url !== 'string') return null;
    
    const trimmedUrl = url.trim();
    if (!trimmedUrl.startsWith('http')) return null;
    
    // Handle Firebase Storage URLs
    if (trimmedUrl.includes('firebasestorage.googleapis.com') && !trimmedUrl.includes('alt=media')) {
      const match = trimmedUrl.match(/\/o\/([^?]+)/);
      if (match && match[1]) {
        const filePath = decodeURIComponent(match[1]);
        return `https://firebasestorage.googleapis.com/v0/b/cardmates-bca66.appspot.com/o/${encodeURIComponent(filePath)}?alt=media`;
      }
    }
    
    return trimmedUrl;
  };

  const processedUrl = processUrl(imageUrl);

  // Handle load events
  const handleLoad = (event) => {
    setLoading(false);
    setError(false);
    onLoad?.(event);
  };

  const handleImageError = (event) => {
    
    if (retryEnabled && retryCount < maxRetries) {
      // Retry loading
      setRetryCount(prev => prev + 1);
      setLoading(true);
      setError(false);
      // The retry will happen automatically when the component re-renders
    } else {
      setLoading(false);
      setError(true);
      onError?.(event);
    }
  };

  const handleRetry = () => {
    if (processedUrl && retryCount < maxRetries) {
      setRetryCount(prev => prev + 1);
      setLoading(true);
      setError(false);
    }
  };

  // Error state
  if (error || !processedUrl) {
    return (
      <View style={containerStyle}>
        <Icon name="image-broken-variant" size={30} color="#999" />
        <Text style={{
          color: '#666',
          fontSize: 12,
          marginTop: 8,
          textAlign: 'center',
          paddingHorizontal: 8,
        }}>
          {placeholder}
        </Text>
        {retryEnabled && retryCount < maxRetries && processedUrl && (
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

  return (
    <View style={containerStyle}>
      {loading && (
        <View style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(245, 245, 245, 0.9)',
          zIndex: 2,
          borderRadius: 16,
        }}>
          <ActivityIndicator size="small" color={rarityColor} />
          <Text style={{
            color: '#666',
            fontSize: 12,
            marginTop: 8,
          }}>
            Loading...
          </Text>
        </View>
      )}
      
      <Image
        source={{ 
          uri: processedUrl,
          cache: 'force-cache' 
        }}
        style={imageStyle}
        resizeMode={resizeMode}
        onLoad={handleLoad}
        onError={handleImageError}
        key={`image-${processedUrl}-${retryCount}`} // Force re-render on retry
      />
    </View>
  );
};

export default SimpleCardImage; 