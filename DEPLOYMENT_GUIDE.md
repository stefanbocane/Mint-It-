# 🚀 Cardmates Deployment Guide

This guide provides comprehensive instructions for deploying the Cardmates app to production environments.

## 📋 Pre-Deployment Checklist

### ✅ Code Quality & Testing
- [ ] All ESLint warnings and errors resolved
- [ ] Code reviewed and approved
- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] Performance benchmarks met
- [ ] Security vulnerabilities addressed

### ✅ Environment Configuration
- [ ] Production Firebase project configured
- [ ] Environment variables set correctly
- [ ] API endpoints verified
- [ ] Database rules configured
- [ ] Storage rules configured
- [ ] Authentication providers configured

### ✅ Assets & Resources
- [ ] App icons optimized (all sizes)
- [ ] Splash screens optimized
- [ ] Images compressed and optimized
- [ ] Font files included
- [ ] Sound assets optimized

### ✅ Platform Configuration
- [ ] iOS bundle identifier set
- [ ] Android package name set
- [ ] App Store Connect configured (iOS)
- [ ] Google Play Console configured (Android)
- [ ] Push notification certificates configured

## 🔧 Environment Setup

### Required Environment Variables

Create a `.env` file in your deployment environment with these variables:

```bash
# Firebase Configuration
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id
FIREBASE_MEASUREMENT_ID=your_measurement_id

# Expo Configuration
EXPO_PROJECT_ID=your_expo_project_id

# Environment
NODE_ENV=production

# Performance Monitoring
ENABLE_PERFORMANCE_MONITORING=true
ENABLE_CRASH_REPORTING=true

# Debug Settings (set to false in production)
ENABLE_DEBUG_LOGS=false
```

### EAS Configuration

Ensure your `eas.json` is properly configured with:
- Build profiles (development, preview, production)
- Environment variables
- Platform-specific settings
- Submission configuration

## 📱 Build Process

### Prerequisites

1. **Install EAS CLI:**
   ```bash
   npm install -g eas-cli
   ```

2. **Login to Expo:**
   ```bash
   eas login
   ```

3. **Configure EAS:**
   ```bash
   eas build:configure
   ```

### Build Commands

#### Development Build
```bash
npm run deploy preview
```

#### Production Build
```bash
# Build for all platforms
npm run deploy all production

# Build for specific platforms
npm run deploy:ios
npm run deploy:android
```

#### Using Direct EAS Commands
```bash
# Preview builds
eas build --profile preview --platform all

# Production builds
eas build --profile production --platform all
eas build --profile production --platform ios
eas build --profile production --platform android
```

## 🔐 Security Considerations

### Firebase Security
- [ ] Firestore security rules configured
- [ ] Storage security rules configured
- [ ] API keys restricted to specific domains/apps
- [ ] Database access limited to authenticated users

### App Security
- [ ] Sensitive data encrypted
- [ ] API endpoints secured with authentication
- [ ] User input validation implemented
- [ ] SQL injection prevention in place

### Environment Variables
- [ ] No hardcoded secrets in source code
- [ ] Environment variables used for all sensitive configuration
- [ ] Different environments (dev/staging/prod) properly isolated

## 🚀 Deployment Steps

### Step 1: Pre-Deployment Checks
```bash
# Run the automated deployment script
npm run deploy

# Or manual checks
npm run check-deps
npm run lint
npm test
```

### Step 2: Build Optimization
```bash
# Clear caches and optimize
npm run optimize

# Clean prebuild
npm run prebuild:clean
```

### Step 3: Production Build
```bash
# Build for production
npm run build:production

# Or use deployment script
npm run deploy all production
```

### Step 4: App Store Submission

#### iOS App Store
```bash
# Submit to App Store
npm run submit:ios

# Or manual submission
eas submit --platform ios
```

#### Google Play Store
```bash
# Submit to Play Store
npm run submit:android

# Or manual submission
eas submit --platform android
```

## 📊 Monitoring & Analytics

### Performance Monitoring
- Firebase Performance Monitoring enabled
- Crash reporting configured
- User analytics tracking

### Error Tracking
- Crashlytics integration
- Error boundary implementation
- Logging service configured

## 🔄 CI/CD Pipeline

### GitHub Actions Setup (Optional)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run lint
      - run: npm test
      - run: npm run deploy all production
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
          FIREBASE_API_KEY: ${{ secrets.FIREBASE_API_KEY }}
          # Add other environment variables
```

## ⚠️ Troubleshooting

### Common Issues

#### Build Failures
- Check EAS build logs
- Verify environment variables
- Check for dependency conflicts
- Ensure proper code signing certificates

#### Metro Bundle Errors
```bash
# Clear Metro cache
npx expo export:clear

# Reset Metro configuration
npx react-native start --reset-cache
```

#### Firebase Connection Issues
- Verify Firebase configuration
- Check network connectivity
- Validate API keys and project settings

### Debug Commands
```bash
# Check Expo doctor
npx expo doctor

# Verify EAS configuration
eas build:configure

# Check build status
eas build:list
```

## 📱 Platform-Specific Notes

### iOS Deployment
- Requires Apple Developer Account
- Code signing certificates needed
- App Store Review Guidelines compliance
- TestFlight for beta testing

### Android Deployment
- Google Play Console account required
- App signing key management
- Google Play policies compliance
- Internal testing track available

## 🔄 Update Strategy

### Over-the-Air (OTA) Updates
```bash
# Publish update
eas update --branch production --message "Bug fixes and improvements"
```

### Store Updates
- Major version changes require store submission
- Follow semantic versioning
- Update app store listings and metadata

## 📞 Support & Resources

- [Expo Documentation](https://docs.expo.dev/)
- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [Firebase Documentation](https://firebase.google.com/docs)
- [React Native Documentation](https://reactnative.dev/docs/getting-started)

---

## 📋 Quick Deployment Commands

```bash
# Full deployment to production
npm run deploy all production

# Preview build for testing
npm run deploy preview

# iOS only production build
npm run deploy:ios

# Android only production build
npm run deploy:android

# Check deployment readiness
npm run check-deps
```

---

**Last updated:** $(date)
**Version:** 1.0.0 