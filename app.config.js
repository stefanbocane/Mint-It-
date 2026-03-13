export default {
  expo: {
    name: "Cardmates",
    slug: "Cardmates",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    userInterfaceStyle: "automatic",
    sdkVersion: "53.0.0",
    runtimeVersion: "53",
    entryPoint: "./index.js",
    projectId: process.env.EXPO_PROJECT_ID,
    splash: {
      image: "./assets/images/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },
    updates: {
      url: `https://u.expo.dev/${process.env.EXPO_PROJECT_ID}`
    },
    assetBundlePatterns: [
      "**/*"
    ],
    fonts: {
      "MaterialCommunityIcons": "./node_modules/@expo/vector-icons/fonts/MaterialCommunityIcons.ttf"
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.cardmates.app",
      infoPlist: {
        "NSCameraUsageDescription": "Allow Cardmates to access your camera to take photos for minting cards",
        "NSPhotoLibraryUsageDescription": "Allow Cardmates to access your photos to select images for minting cards",
        "UIBackgroundModes": [
          "remote-notification"
        ]
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#ffffff"
      },
      package: "com.cardmates.app",
      permissions: [
        "android.permission.CAMERA",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.RECORD_AUDIO",
        "android.permission.RECEIVE_BOOT_COMPLETED",
        "android.permission.VIBRATE"
      ],
      useNextNotificationsApi: true
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png"
    },
    plugins: [
      "expo-secure-store",
      "expo-web-browser",
      "expo-splash-screen",
      "expo-image-picker",
      "expo-camera",
      "expo-notifications"
    ],
    experiments: {
      tsconfigPaths: true
    },
    extra: {
      // Firebase configuration - use environment variables
      firebaseApiKey: process.env.FIREBASE_API_KEY,
      firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN,
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
      firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      firebaseAppId: process.env.FIREBASE_APP_ID,
      firebaseMeasurementId: process.env.FIREBASE_MEASUREMENT_ID,
      eas: {
        projectId: process.env.EXPO_PROJECT_ID
      },
      // Environment configuration
      environment: process.env.NODE_ENV || "development",
      apiBaseUrl: process.env.API_BASE_URL,
      enableDebugLogs: process.env.ENABLE_DEBUG_LOGS === 'true',
      enablePerformanceMonitoring: process.env.ENABLE_PERFORMANCE_MONITORING === 'true',
    }
  }
}; 