// Metro configuration for Expo with production optimizations
const { getDefaultConfig } = require('@expo/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

// Add the additional extensions and asset types
defaultConfig.resolver.sourceExts = ['jsx', 'js', 'ts', 'tsx', 'json', 'mjs', 'cjs'];
defaultConfig.resolver.assetExts = [...defaultConfig.resolver.assetExts, 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ttf', 'mp3', 'wav'];

// Firebase compatibility fixes for Expo SDK 53
defaultConfig.resolver.unstable_enablePackageExports = false;

// Production optimizations
if (process.env.NODE_ENV === 'production') {
  // Enable minification
  defaultConfig.transformer.minifierConfig = {
    keep_fnames: true,
    mangle: {
      keep_fnames: true,
    },
  };
  
  // Optimize asset bundles
  defaultConfig.transformer.assetRegistryPath = 'react-native/Libraries/Image/AssetRegistry';
  
  // Enable tree shaking
  defaultConfig.resolver.platforms = ['native', 'android', 'ios'];
}

// Remove custom cache configuration that was causing issues
// Let Metro use its default cache system

module.exports = defaultConfig; 