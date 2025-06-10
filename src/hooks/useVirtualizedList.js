import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Dimensions } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export const useVirtualizedList = (data, itemsPerRow = 2) => {
  const flatListRef = useRef(null);
  const viewabilityConfigRef = useRef({
    viewAreaCoveragePercentThreshold: 50,
    waitForInteraction: true,
    minimumViewTime: 250,
  });

  // Optimized item layout calculation
  const getItemLayout = useCallback((_, index) => {
    const ITEM_HEIGHT = (SCREEN_WIDTH - 24) / itemsPerRow * 1.43;
    const ITEM_MARGIN = 8;
    const rowIndex = Math.floor(index / itemsPerRow);
    
    return {
      length: ITEM_HEIGHT + ITEM_MARGIN,
      offset: (ITEM_HEIGHT + ITEM_MARGIN) * rowIndex,
      index,
    };
  }, [itemsPerRow]);

  // Optimized key extractor with stable keys
  const keyExtractor = useCallback((item, index) => {
    return item.id ? `${item.id}-${index}` : `item-${index}`;
  }, []);

  // Performance-optimized virtualization settings
  const virtualizationConfig = useMemo(() => {
    const deviceMemory = navigator.deviceMemory || 4; // Default to 4GB if not available
    const isLowEndDevice = deviceMemory < 4;
    
    return {
      // Reduce for low-end devices
      initialNumToRender: isLowEndDevice ? 8 : 16,
      maxToRenderPerBatch: isLowEndDevice ? 4 : 8,
      windowSize: isLowEndDevice ? 5 : 8,
      
      // Performance optimizations
      removeClippedSubviews: true,
      disableVirtualization: false,
      updateCellsBatchingPeriod: isLowEndDevice ? 150 : 100,
      
      // Scroll optimizations
      scrollEventThrottle: 16,
      decelerationRate: 'normal',
      
      // Memory management
      getItemLayout,
      keyExtractor,
      
      // Viewability config
      viewabilityConfig: viewabilityConfigRef.current,
    };
  }, [getItemLayout, keyExtractor]);

  // Scroll to top function
  const scrollToTop = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  // Scroll to index function
  const scrollToIndex = useCallback((index, animated = true) => {
    flatListRef.current?.scrollToIndex({ index, animated });
  }, []);

  // Preload optimization - prefetch data for smoother scrolling
  const onEndReachedThreshold = useMemo(() => {
    // Adjust threshold based on data size
    if (data.length < 50) return 0.5;
    if (data.length < 200) return 0.3;
    return 0.1; // For large datasets, load more aggressively
  }, [data.length]);

  // Memory monitoring for development
  useEffect(() => {
    if (__DEV__) {
      const interval = setInterval(() => {
        if (data.length > 500) {
          console.log(`📱 VirtualizedList: Rendering ${data.length} items. Consider pagination.`);
        }
      }, 30000);
      
      return () => clearInterval(interval);
    }
  }, [data.length]);

  // Return optimized props and utility functions
  return {
    flatListRef,
    virtualizationConfig: {
      ...virtualizationConfig,
      onEndReachedThreshold,
    },
    scrollToTop,
    scrollToIndex,
    keyExtractor,
    getItemLayout,
  };
}; 