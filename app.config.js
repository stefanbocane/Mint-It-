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
    splash: {
      image: "./assets/images/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },
    updates: {
      url: "https://u.expo.dev/420acf72-35f8-422e-935e-88116abe9832"
    },
    assetBundlePatterns: [
      "**/*"
    ],
    fonts: {
      "MaterialCommunityIcons": "./node_modules/@expo/vector-icons/fonts/MaterialCommunityIcons.ttf"
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.anonymous.Cardmates",
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
      package: "com.anonymous.Cardmates",
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
      firebaseApiKey: "REDACTED_FIREBASE_API_KEY",
      firebaseAuthDomain: "cardmates-bca66.firebaseapp.com",
      firebaseProjectId: "cardmates-bca66",
      firebaseStorageBucket: "cardmates-bca66.firebasestorage.app",
      firebaseMessagingSenderId: "37257408298",
      firebaseAppId: "1:37257408298:web:6665c30d84f2f78d8af853",
      firebaseMeasurementId: "G-8VTS46M32H",
      eas: {
        projectId: "420acf72-35f8-422e-935e-88116abe9832"
      }
    }
  }
}; 