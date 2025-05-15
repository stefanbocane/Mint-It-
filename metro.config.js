// Metro configuration for Expo
const { getDefaultConfig } = require('@expo/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

// Add the additional extensions and asset types
defaultConfig.resolver.sourceExts = ['jsx', 'js', 'ts', 'tsx', 'json', 'mjs', 'cjs'];
defaultConfig.resolver.assetExts = [...defaultConfig.resolver.assetExts, 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ttf'];

// Firebase compatibility fixes for Expo SDK 53
defaultConfig.resolver.unstable_enablePackageExports = false;

module.exports = defaultConfig; 