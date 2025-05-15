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
