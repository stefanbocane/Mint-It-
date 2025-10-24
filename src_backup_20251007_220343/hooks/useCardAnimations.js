import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Animated, Easing } from 'react-native';

export const useCardAnimations = () => {
  const cardScaleAnim = useRef(new Animated.Value(0)).current;
  const cardRotateAnim = useRef(new Animated.Value(0)).current;
  const cardOpacityAnim = useRef(new Animated.Value(0)).current;
  const cardDetailsAnim = useRef(new Animated.Value(0)).current;
  const detailsShimmerAnim = useRef(new Animated.Value(-100)).current;

  const startPreviewAnimation = () => {
    // Reset all animations
    cardScaleAnim.setValue(0);
    cardRotateAnim.setValue(0);
    cardOpacityAnim.setValue(0);
    cardDetailsAnim.setValue(0);
    detailsShimmerAnim.setValue(-100);
    
    // Enhanced entrance animation sequence
    Animated.sequence([
      // Dramatic scale entrance with bounce
      Animated.spring(cardScaleAnim, {
        toValue: 1,
        tension: 60,
        friction: 6,
        useNativeDriver: true
      }),
      // Fade in content with stagger effect
      Animated.stagger(150, [
        Animated.timing(cardOpacityAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true
        }),
        Animated.timing(cardDetailsAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true
        })
      ])
    ]).start();
    
    // Enhanced continuous floating rotation
    Animated.loop(
      Animated.sequence([
        Animated.timing(cardRotateAnim, {
          toValue: 1,
          duration: 3000,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
          useNativeDriver: true
        }),
        Animated.timing(cardRotateAnim, {
          toValue: -1,
          duration: 3000,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
          useNativeDriver: true
        }),
        Animated.timing(cardRotateAnim, {
          toValue: 0,
          duration: 3000,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
          useNativeDriver: true
        })
      ])
    ).start();

    // Enhanced shimmer effect with faster speed
    Animated.loop(
      Animated.timing(detailsShimmerAnim, {
        toValue: 100,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true
      })
    ).start();

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.log('Haptics not available');
    }
  };

  const startExitAnimation = (onComplete) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      console.log('Haptics not available');
    }

    // Enhanced exit animation with scale and fade
    Animated.parallel([
      Animated.timing(cardScaleAnim, {
        toValue: 0.7,
        duration: 250,
        easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        useNativeDriver: true
      }),
      Animated.timing(cardOpacityAnim, {
        toValue: 0,
        duration: 200,
        easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        useNativeDriver: true
      }),
      Animated.timing(cardDetailsAnim, {
        toValue: 0,
        duration: 150,
        easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        useNativeDriver: true
      })
    ]).start(() => {
      onComplete?.();
    });
  };

  const cleanupAnimations = () => {
    [cardScaleAnim, cardRotateAnim, cardOpacityAnim, cardDetailsAnim, detailsShimmerAnim].forEach(anim => {
      anim.removeAllListeners();
    });
  };

  return {
    animations: {
      cardScaleAnim,
      cardRotateAnim,
      cardOpacityAnim,
      cardDetailsAnim,
      detailsShimmerAnim
    },
    startPreviewAnimation,
    startExitAnimation,
    cleanupAnimations
  };
}; 