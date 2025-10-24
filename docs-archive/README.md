# Cardmates - Digital Trading Card Platform

A React Native mobile application for digital trading card collection, trading, and auctions built with Expo and Firebase.

## Overview

Cardmates is a comprehensive digital trading card platform that allows users to:
- Capture and mint digital trading cards using their device camera
- Trade cards with other users in their groups
- Participate in live auctions
- Collect cards in organized sets with rarity-based gameplay
- Earn gems and XP through various activities

## Tech Stack

- **Frontend**: React Native with Expo
- **Backend**: Firebase (Firestore, Storage, Authentication)
- **Navigation**: React Navigation 6
- **UI Components**: React Native Paper (Material Design 3)
- **Animations**: React Native Reanimated 3
- **State Management**: React Context API with custom providers
- **Caching**: Advanced multi-layer caching system with TTL management

## Key Features

### 🎴 Card System
- Camera-based card creation with real-time image processing
- Automatic rarity assignment and validation
- Advanced border effects and animations
- Comprehensive card management with collection organization

### 💎 Economics System
- Dual currency system (Coins & Gems)
- XP progression with achievement tracking
- Auction marketplace with real-time bidding
- Trading system with verification and security

### 🔐 Security & Performance
- Age verification system with parental consent
- Comprehensive terms & privacy policy implementation
- Advanced database optimization with intelligent caching
- Real-time data synchronization with conflict resolution

### 👥 Social Features
- Group-based trading communities
- Real-time notifications for trades and auctions
- Leaderboards and achievement systems
- Admin controls for group management

## Project Structure

```
├── src/
│   ├── components/          # Reusable UI components
│   ├── screens/            # Screen components
│   ├── navigation/         # Navigation configuration
│   ├── contexts/           # React Context providers
│   ├── services/           # Business logic and API services
│   ├── utils/              # Utility functions and optimizations
│   ├── hooks/              # Custom React hooks
│   └── config/             # Configuration files
├── scripts/                # Deployment and maintenance scripts
└── docs/                   # Additional documentation
```

## Development Setup

### Prerequisites
- Node.js 18+ 
- Expo CLI (`npm install -g @expo/cli`)
- iOS Simulator (macOS) or Android Studio
- Firebase project configured

### Installation

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd cardmates
   npm install
   ```

2. **Configure environment variables:**
   Create `.env` file with your Firebase configuration:
   ```env
   EXPO_PUBLIC_FIREBASE_API_KEY=your_api_key
   EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   EXPO_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
   EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
   EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   EXPO_PUBLIC_FIREBASE_APP_ID=your_app_id
   ```

3. **Start development server:**
   ```bash
   npx expo start
   ```

## Deployment

### Production Build
```bash
# Build for production
npm run build:production

# Deploy to EAS
npm run deploy:production
```

### Environment Configuration
The app supports multiple environments:
- **Development**: Local testing with emulators
- **Preview**: Staging environment for testing
- **Production**: Live production environment

## Performance Features

### Advanced Caching System
- Multi-layer caching with TTL management
- Intelligent cache warming and prefetching
- Background cache maintenance
- Query deduplication and aggregation

### Database Optimization
- Batch operations for improved efficiency
- Smart listener management with connection pooling
- Read optimization with strategic indexing
- Real-time data synchronization

### UI/UX Optimizations
- Virtualized lists for large datasets
- Optimistic updates for immediate feedback
- Progressive image loading with fallbacks
- Gesture-based interactions with haptic feedback

## API Services

### Auction Services
- Real-time bidding system
- Automatic auction completion
- Winner notification system
- Anti-fraud bid validation

### Gem Rewards System
- Achievement-based rewards
- Daily bonus system
- Activity tracking and XP calculation
- Automated reward distribution

## Security & Compliance

### Age Verification
- COPPA compliance with parental consent
- Secure age verification flow
- Terms and conditions acceptance
- Privacy policy implementation

### Data Protection
- Firestore security rules
- Storage access controls
- User data anonymization options
- Secure authentication flows

## Monitoring & Analytics

### Performance Monitoring
- Real-time performance metrics
- Error tracking and reporting
- Database read/write optimization
- Cache hit rate monitoring

### User Analytics
- Achievement tracking
- Trading activity monitoring
- Auction participation metrics
- User engagement analytics

## Troubleshooting

### Common Issues

1. **Firebase Connection Issues**
   ```bash
   # Check Firebase configuration
   npm run troubleshoot
   ```

2. **Cache Issues**
   ```bash
   # Clear application cache
   npx expo start --clear
   ```

3. **Build Issues**
   ```bash
   # Clean and rebuild
   npm run clean
   npm install
   npx expo start
   ```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions:
- Create an issue in this repository
- Check the troubleshooting guide
- Review the deployment documentation

---

**Built with ❤️ using React Native and Firebase**

# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

# Firebase Optimization Recommendations

## Implemented Changes

1. **Create Auction Modal:** Updated the design from fullscreen to a popup modal while maintaining all functionality.

2. **Reduced Firebase Reads:**
   - Increased cache TTL from 30s to 2min for auction bidder data
   - Reduced snapshot listener update frequency with 5s heartbeat
   - Decreased batch sizes and added delays between queries
   - Reduced auction limit from 50 to 30 items
   - Extended auction expiration check interval from 30s to 60s
   - Implemented efficient bidder count caching

3. **Batched Operations:**
   - Process auctions in smaller batches of 5 to reduce concurrent reads
   - Added small delay (300ms) between batch operations

## Further Optimization Suggestions

1. **Implement Additional Caching:**
   - Cache user data after first fetch
   - Store card information locally to reduce redundant lookups
   - Cache common queries with longer TTL values

2. **Optimize Data Structure:**
   - Store bidder count directly on auction documents
   - Denormalize critical data to reduce joins
   - Add composite indexes for common query patterns

3. **Batch Database Updates:**
   - Group related writes into batch operations
   - Combine multiple small updates into single transactions

4. **Implement Pagination:**
   - Load auctions in pages (10-15 items per page)
   - Implement infinite scroll instead of loading all items at once

5. **Optimize Real-time Listeners:**
   - Only listen to auctions ending soon or with recent activity
   - Use document-level listeners for active bidding auctions
   - Detach listeners when views are inactive

6. **Implement Offline Support:**
   - Configure Firebase for offline persistence
   - Add better error handling for offline operations
   - Implement queue system for operations when offline

7. **Performance Monitoring:**
   - Add Firebase Performance Monitoring
   - Identify and optimize high-cost operations
   - Track read/write usage patterns

8. **Backend Functions:**
   - Move expensive operations to Cloud Functions
   - Use scheduled functions for maintenance tasks
   - Implement aggregation in the backend

9. **Data Expiration:**
   - Implement TTL for completed auctions
   - Archive old data to cold storage
   - Use Firestore TTL feature (when available)

By implementing these optimizations, you can significantly reduce Firebase costs while maintaining application performance.

# Recent Bug Fixes

## AuctionScreen.js Fixes (May 9, 2024)

1. **Fixed TypeError:** 
   - Added missing `runTransaction` import from Firebase
   - Fixed undefined references causing `.indexOf is not a function` error
   - Added proper error handling for array operations

2. **Enhanced Firestore Index Error Handling:**
   - Added robust error handling for missing index errors
   - Created utility functions to extract and display index creation URLs
   - Implemented query fallback system for when indexes aren't yet available

3. **New Utility Functions:**
   - Added `executeQueryWithFallback` to handle index errors gracefully
   - Created `extractIndexCreationUrl` to make index creation easier
   - Enhanced error handling throughout the app

4. **Code Robustness Improvements:**
   - Added null checks and default values to prevent undefined errors
   - Enhanced error reporting with specific error messages
   - Implemented proper error state handling in UI components
   - Fixed batch operations to be more resilient

## How to Use

1. **If you see an index error:**
   - Look for the console log message with the index creation URL
   - Click the link to create the required Firestore index
   - Wait a few minutes for the index to build before trying again

2. **For development:**
   - Use the backup files (.broken, .fixed) for comparison if needed
   - Check the error handling patterns for implementing in other components
