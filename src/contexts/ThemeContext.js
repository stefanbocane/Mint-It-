import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DarkTheme, DefaultTheme } from 'react-native-paper';

// Create a fallback theme in case the default themes fail
const fallbackTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#9B5DE5',
    accent: '#4FC3A1',
    background: '#f6f6f6',
    surface: '#ffffff',
    error: '#B00020',
    text: '#000000',
    onSurface: '#000000',
    disabled: '#757575',
    placeholder: '#9E9E9E',
    backdrop: 'rgba(0, 0, 0, 0.5)',
    notification: '#f50057',
    textSecondary: '#666666',
  },
};

const ThemeContext = createContext({
  theme: fallbackTheme,
  isDarkMode: false,
  toggleTheme: () => {},
});

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    console.warn('Theme context not found, using fallback theme');
    return { theme: fallbackTheme, isDarkMode: false, toggleTheme: () => {} };
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Memoize the theme calculation to prevent unnecessary recalculations
  const theme = useMemo(() => {
    try {
      const baseTheme = isDarkMode ? DarkTheme : DefaultTheme;
      return {
        ...baseTheme,
        colors: {
          ...baseTheme.colors,
          ...fallbackTheme.colors,
        },
      };
    } catch (error) {
      console.warn('Error getting theme, using fallback:', error);
      return fallbackTheme;
    }
  }, [isDarkMode]);

  // Memoize toggle function to maintain stable reference
  const toggleTheme = useCallback(() => {
    setIsDarkMode(prevMode => !prevMode);
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    theme,
    isDarkMode,
    toggleTheme,
  }), [theme, isDarkMode, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}; 