import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';

const baseColors = {
  primary: '#9B5DE5',
  secondary: '#4FC3A1',
  error: '#B00020',
  background: '#FFFFFF',
  surface: '#FFFFFF',
  text: '#000000',
  textSecondary: '#666666',
  placeholder: '#999999',
  outline: '#E0E0E0',
  disabled: '#CCCCCC',
  success: '#4FC3A1',
  warning: '#FFC107',
  info: '#2196F3',
  rarity: {
    common: '#9CA3AF',
    rare: '#3B82F6',
    legendary: '#F59E0B'
  }
};

const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48
};

const lightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    ...baseColors,
  },
  spacing,
  roundness: 8,
};

const darkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    ...baseColors,
    background: '#121212',
    surface: '#1E1E1E',
    text: '#FFFFFF',
    textSecondary: '#AAAAAA',
    outline: '#333333',
  },
  spacing,
  roundness: 8,
};

export { darkTheme, lightTheme };
export default lightTheme;
