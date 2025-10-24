import { CameraView as Camera, Camera as ExpoCamera } from 'expo-camera';
import React, { useCallback, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { PinchGestureHandler, State, TapGestureHandler } from 'react-native-gesture-handler';
import { Button, IconButton, Text } from 'react-native-paper';
import Animated, {
    runOnJS,
    useAnimatedGestureHandler,
    useAnimatedStyle,
    useSharedValue
} from 'react-native-reanimated';
import { createPerformanceTimer } from '../utils/performanceMonitor';

// Camera configuration constants
const CAMERA_CONFIG = {
  MAX_ZOOM: 2,
  MIN_ZOOM: 1,
  PHOTO_QUALITY: 0.8
};

const FLASH_MODE = {
  OFF: 'off',
  ON: 'on',
  AUTO: 'auto'
};

const CameraComponent = ({ 
  onPictureTaken, 
  disabled = false,
  style 
}) => {
  // Camera state
  const [hasPermission, setHasPermission] = useState(null);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [cameraFacing, setCameraFacing] = useState('back');
  const [error, setError] = useState(null);

  // Refs
  const cameraRef = useRef(null);
  const operationInProgressRef = useRef(false);

  // Zoom functionality
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const [currentZoom, setCurrentZoom] = useState(0);
  const zoomUpdateThrottle = useRef(0);

  // Zoom validation utility
  const validateAndGetSafeZoom = useCallback((zoomValue) => {
    return Math.max(0, Math.min(zoomValue || 0, 1));
  }, []);

  // Enhanced gesture handler with crash prevention
  const pinchGestureHandler = useAnimatedGestureHandler({
    onStart: () => {
      savedScale.value = scale.value;
    },
    onActive: (event) => {
      const baseScale = savedScale.value;
      const gestureScale = Math.max(0.1, Math.min(event.scale, CAMERA_CONFIG.MAX_ZOOM));
      const newScale = baseScale * gestureScale;
      
      const clampedScale = Math.max(CAMERA_CONFIG.MIN_ZOOM, Math.min(newScale, CAMERA_CONFIG.MAX_ZOOM));
      scale.value = clampedScale;
      
      const zoomValue = Math.max(0, Math.min((clampedScale - CAMERA_CONFIG.MIN_ZOOM) / (CAMERA_CONFIG.MAX_ZOOM - CAMERA_CONFIG.MIN_ZOOM), 1));
      
      // Throttle zoom updates
      const now = Date.now();
      if (now - zoomUpdateThrottle.current > 100) {
        runOnJS(setCurrentZoom)(zoomValue);
        zoomUpdateThrottle.current = now;
      }
    },
    onEnd: () => {
      const finalScale = Math.max(CAMERA_CONFIG.MIN_ZOOM, Math.min(scale.value, CAMERA_CONFIG.MAX_ZOOM));
      scale.value = finalScale;
      savedScale.value = finalScale;
      
      const finalZoom = validateAndGetSafeZoom((finalScale - CAMERA_CONFIG.MIN_ZOOM) / (CAMERA_CONFIG.MAX_ZOOM - CAMERA_CONFIG.MIN_ZOOM));
      runOnJS(setCurrentZoom)(finalZoom);
    },
  });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Camera permission setup
  const setupCamera = useCallback(async () => {
    const timer = createPerformanceTimer('cameraSetup');
    
    try {
      const { status } = await ExpoCamera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
      if (status !== 'granted') {
        setError('Camera permission denied');
      }
    } catch (error) {
      console.error('❌ Camera permission error:', error);
      setError(`Camera permission error: ${error.message}`);
      setHasPermission(false);
    } finally {
      timer.end();
    }
  }, []);

  // Take picture functionality
  const takePicture = useCallback(async () => {
    if (!cameraRef.current || operationInProgressRef.current || disabled) {
      return;
    }
    
    operationInProgressRef.current = true;
    const timer = createPerformanceTimer('takePicture');
    
    try {
      const safeZoom = validateAndGetSafeZoom(currentZoom);
      
      if (!cameraRef.current || typeof cameraRef.current.takePictureAsync !== 'function') {
        throw new Error('Camera is not available or ready');
      }

      const photo = await cameraRef.current.takePictureAsync({
        quality: CAMERA_CONFIG.PHOTO_QUALITY,
        base64: false,
        skipProcessing: false
      });

      if (!photo?.uri) {
        throw new Error('Failed to capture image');
      }

      console.log(`✅ Picture taken successfully: ${photo.width}x${photo.height}`);
      onPictureTaken?.(photo.uri);
      
    } catch (error) {
      console.error('❌ Error taking picture:', error);
      const errorMessage = error.message?.includes('not available') 
        ? 'Camera is not ready. Please try again in a moment.'
        : `Failed to take picture: ${error.message}. Please try again.`;
      Alert.alert('Camera Error', errorMessage);
    } finally {
      operationInProgressRef.current = false;
      timer.end();
    }
  }, [currentZoom, disabled, onPictureTaken, validateAndGetSafeZoom]);

  // Camera controls
  const toggleFlash = useCallback(() => {
    setFlashEnabled(prev => {
      const newState = !prev;
      console.log('💡 Flash toggled:', newState ? 'ON' : 'OFF');
      return newState;
    });
  }, []);

  const handleDoubleTap = useCallback(() => {
    try {
      setCameraFacing(prev => {
        const newType = prev === 'back' ? 'front' : 'back';
        console.log('🔄 Camera flipped to:', newType);
        
        // Reset zoom when flipping camera
        scale.value = 1;
        savedScale.value = 1;
        setCurrentZoom(0);
        
        return newType;
      });
    } catch (error) {
      console.error('❌ Error flipping camera:', error);
      Alert.alert('Camera Error', 'Failed to flip camera. Please try again.');
    }
  }, [scale, savedScale]);

  // Initialize camera on mount
  React.useEffect(() => {
    setupCamera();
  }, [setupCamera]);

  // Permission states
  if (hasPermission === null) {
    return (
      <View style={[styles.centerContent, style]}>
        <Text style={styles.permissionText}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (hasPermission === false || error) {
    return (
      <View style={[styles.centerContent, style]}>
        <Text style={styles.permissionText}>
          {error || 'Camera access is required to take pictures.'}
        </Text>
        <Button 
          mode="contained" 
          onPress={setupCamera}
          style={styles.retryButton}
        >
          Grant Permission
        </Button>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <View style={styles.cameraContainer}>
        <TapGestureHandler
          numberOfTaps={2}
          onHandlerStateChange={({ nativeEvent }) => {
            if (nativeEvent.state === State.ACTIVE) {
              handleDoubleTap();
            }
          }}
        >
          <Animated.View style={styles.cameraWrapper}>
            <PinchGestureHandler onGestureEvent={pinchGestureHandler}>
              <Animated.View style={[styles.cameraInner, animatedStyle]}>
                <Camera 
                  key={`camera-${cameraFacing}`}
                  style={styles.camera} 
                  ref={cameraRef}
                  enableTorch={flashEnabled}
                  flash={flashEnabled ? FLASH_MODE.ON : FLASH_MODE.OFF}
                  facing={cameraFacing}
                  zoom={validateAndGetSafeZoom(currentZoom)}
                />
              </Animated.View>
            </PinchGestureHandler>
          </Animated.View>
        </TapGestureHandler>
      </View>
      
      <View style={styles.buttonContainer}>
        <Button
          mode="contained"
          onPress={takePicture}
          style={styles.button}
          icon="camera"
          disabled={disabled}
        >
          Take Picture
        </Button>
        <IconButton
          icon={flashEnabled ? "flash" : "flash-off"}
          mode="contained"
          size={30}
          onPress={toggleFlash}
          style={styles.flashButton}
          iconColor={flashEnabled ? "#ffff00" : "#ffffff"}
          containerColor="rgba(0,0,0,0.5)"
        />
        <IconButton
          icon="camera-flip"
          mode="contained"
          size={30}
          onPress={handleDoubleTap}
          style={styles.flipButton}
          iconColor="#ffffff"
          containerColor="rgba(0,0,0,0.5)"
        />
      </View>
      
      {/* Zoom indicator */}
      {currentZoom > 0.1 && (
        <View style={styles.zoomIndicator}>
          <Text style={styles.zoomText}>
            {(currentZoom * (CAMERA_CONFIG.MAX_ZOOM - CAMERA_CONFIG.MIN_ZOOM) + CAMERA_CONFIG.MIN_ZOOM).toFixed(1)}x
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  permissionText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    minWidth: 120,
  },
  cameraContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  cameraWrapper: {
    flex: 1,
  },
  cameraInner: {
    flex: 1,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
  },
  button: {
    flex: 1,
    marginHorizontal: 6,
    minHeight: 38,
    maxHeight: 42,
    borderRadius: 12,
    elevation: 2,
  },
  flashButton: {
    marginLeft: 8,
    borderRadius: 30,
    elevation: 3,
  },
  flipButton: {
    marginLeft: 8,
    borderRadius: 30,
    elevation: 3,
  },
  zoomIndicator: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 4,
    borderRadius: 8,
  },
  zoomText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default CameraComponent; 