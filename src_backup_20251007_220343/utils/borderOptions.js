// Enhanced border options with animation properties
export const BORDER_OPTIONS = [
  { 
    id: 'default', 
    name: 'Default Border', 
    price: 0, 
    color: '#808080', 
    description: 'Reset to the default border based on card rarity',
    animationType: 'none',
    secondaryColor: '#808080',
  },
  { 
    id: 'neon', 
    name: 'Neon Glow', 
    price: 25, 
    color: '#00FF00', 
    description: 'A vibrant neon green glow with electric pulses',
    animationType: 'pulse',
    secondaryColor: '#00FF88',
    glowIntensity: 12,
  },
  { 
    id: 'gold', 
    name: 'Gold Frame', 
    price: 50, 
    color: '#FFD700', 
    description: 'Luxurious gold frame',
    animationType: 'gentle_shimmer',
    secondaryColor: '#FFED4E',
    glowIntensity: 4,
  },
  { 
    id: 'rainbow', 
    name: 'Rainbow Edge', 
    price: 75, 
    color: '#FF0000', 
    description: 'Mesmerizing rainbow pattern with prismatic effects',
    animationType: 'rainbow_prism',
    secondaryColor: '#FF00FF',
    glowIntensity: 10,
  },
  { 
    id: 'fire', 
    name: 'Fire Border', 
    price: 75, 
    color: '#FF4500', 
    description: 'Blazing flame effect with dynamic ember sparks',
    animationType: 'fire_ember',
    secondaryColor: '#FFCC00',
    glowIntensity: 15,
  },
  { 
    id: 'ice', 
    name: 'Ice Frame', 
    price: 75, 
    color: '#ADD8E6', 
    description: 'Mystical ice crystals with frozen mist effect',
    animationType: 'ice_crystal',
    secondaryColor: '#E0FFFF',
    glowIntensity: 12,
  },
  { 
    id: 'shadow', 
    name: 'Shadow Aura', 
    price: 75, 
    color: '#800080', 
    description: 'Dark mysterious aura with shadow tendrils',
    animationType: 'shadow_wave',
    secondaryColor: '#4B0082',
    glowIntensity: 10,
  },
  { 
    id: 'cosmic', 
    name: 'Cosmic Energy', 
    price: 150, 
    color: '#9400D3', 
    description: 'Otherworldly cosmic energy with stellar shimmer',
    animationType: 'cosmic_pulse',
    secondaryColor: '#00CED1',
    glowIntensity: 18,
  },
  { 
    id: 'lightning', 
    name: 'Lightning Strike', 
    price: 500, 
    color: '#1E90FF', 
    description: 'Electric lightning bolts crackling with raw power',
    animationType: 'lightning_crack',
    secondaryColor: '#FFFFFF',
    glowIntensity: 25,
    specialEffect: true,
  },
]; 

// Helper function to get border animation styles
export const getBorderAnimationStyle = (animationType, borderColor, secondaryColor, glowIntensity = 8) => {
  const baseStyle = {
    borderWidth: 3,
    borderColor: borderColor,
  };

  switch (animationType) {
    case 'pulse':
      return {
        ...baseStyle,
        borderWidth: 4,
        shadowColor: borderColor,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: glowIntensity,
      };
    case 'gentle_shimmer':
      return {
        ...baseStyle,
        borderWidth: 3,
        shadowColor: borderColor,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: glowIntensity,
      };
    case 'rainbow_prism':
      return {
        ...baseStyle,
        borderWidth: 4,
        shadowColor: secondaryColor || borderColor,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: glowIntensity,
      };
    case 'fire_ember':
      return {
        ...baseStyle,
        borderWidth: 5,
        shadowColor: secondaryColor || borderColor,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: glowIntensity,
      };
    case 'ice_crystal':
      return {
        ...baseStyle,
        borderWidth: 4,
        shadowColor: secondaryColor || borderColor,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: glowIntensity,
      };
    case 'shadow_wave':
      return {
        ...baseStyle,
        borderWidth: 4,
        shadowColor: secondaryColor || borderColor,
        shadowOffset: { width: 2, height: 2 },
        shadowOpacity: 0.8,
        shadowRadius: glowIntensity,
      };
    case 'cosmic_pulse':
      return {
        ...baseStyle,
        borderWidth: 6,
        shadowColor: secondaryColor || borderColor,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: glowIntensity,
      };
    case 'lightning_crack':
      return {
        ...baseStyle,
        borderWidth: 5,
        shadowColor: secondaryColor || borderColor,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1.0,
        shadowRadius: glowIntensity,
        backgroundColor: 'rgba(30, 144, 255, 0.1)',
        borderStyle: 'solid',
      };
    case 'none':
    default:
      return baseStyle;
  }
}; 