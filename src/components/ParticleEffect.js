import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

const Particle = ({ startX, startY, color }) => {
  return (
    <View
      style={[
        styles.particle,
        { backgroundColor: color, left: startX, top: startY }
      ]}
    />
  );
};

const ParticleEffect = ({ colors = ['#FFD700', '#FFA500', '#FF4500'], onComplete }) => {
  const particles = Array(10).fill(0).map((_, index) => ({
    id: index,
    startX: Math.random() * 300 + 50,
    startY: Math.random() * 300 + 50,
    color: colors[index % colors.length]
  }));

  useEffect(() => {
    const timer = setTimeout(() => {
      if (onComplete) {
        onComplete();
      }
    }, 500); // Reduced timeout since we're not animating

    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <View style={styles.container}>
      {particles.map((particle) => (
        <Particle
          key={particle.id}
          startX={particle.startX}
          startY={particle.startY}
          color={particle.color}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: 'none',
    zIndex: 1000,
  },
  particle: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

export default ParticleEffect; 