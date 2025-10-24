# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React Native Expo app called "CardMates" - a social card collecting game built with Firebase backend. The app features real-time auctions, card trading, group-based gameplay, and an economy system with coins and gems.

## Development Commands

### Starting Development
```bash
npm start              # Start Expo dev server with cache cleared (default behavior)
npm run start:bypass   # Start without cache clearing (faster)
npm run ios            # Start iOS simulator
npm run android        # Start Android emulator
```

### Testing & Linting
```bash
npm test              # Run Jest tests
npm run lint          # Check for linting errors
npm run lint:fix      # Auto-fix linting issues
```

### Building & Deployment
```bash
npm run prebuild              # Generate native projects
npm run prebuild:clean        # Clean prebuild and regenerate
npm run build:preview         # Build preview for all platforms
npm run build:production      # Build production for all platforms
npm run build:ios             # Build production iOS
npm run build:android         # Build production Android
npm run deploy                # Deploy (runs custom script)
npm run deploy:ios            # Deploy iOS to production
npm run deploy:android        # Deploy Android to production
```

### Firebase
```bash
# Deploy Cloud Functions (no emulator commands in package.json)
cd functions && npm install
firebase deploy --only functions

# To use emulators (configure in firebase.json)
firebase emulators:start
```

## Architecture

### Core Bootstrap Flow

1. **App.js** - Root entry point with provider hierarchy:
   - `AuthContextProvider` - Authentication state
   - `SettingsProvider` - User settings/preferences
   - `ThemeProvider` - Theme management
   - `InitialLoadGate` - Waits for bootstrap data before rendering app
   - `GroupProvider` - Current group context
   - `UnifiedUserDataProvider` - Consolidated user data (balance, gems, profile)

2. **InitialLoadGate + useInitialLoad** (`src/providers/InitialLoadGate.js`, `src/bootstrap/useInitialLoad.js`):
   - Fetches a single document: `initialAppLoad/{userId}_{groupId}`
   - This document contains all essential bootstrap data needed to render the app
   - **Critical**: App waits for this load before rendering main content
   - Stored in Zustand store (`src/store/useInitialStore.js`)

3. **Navigation Structure**:
   - `RootNavigator` → `AuthGuard` → `TabNavigator` (main app tabs)
   - Tab screens: Collection, Auction, Trades, Social, Coin Store, Profile, Leaderboard, Sets

### Read Optimization System (CRITICAL)

This app has an aggressive Firestore read optimization system to minimize database reads:

#### TrackedFirestore (`src/services/ReadTracking/`)
- **All Firestore reads MUST use TrackedFirestore wrapper instead of direct Firebase SDK**
- Replace: `import { getDoc, getDocs } from 'firebase/firestore'`
- With: `import { getDoc, getDocs } from '../services/ReadTracking/TrackedFirestore'`
- Automatically tracks and logs every read operation for monitoring
- Integrated with `ReadMonitor` and `ProductionMonitor` for alerting

#### GlobalListenerCoordinator (`src/utils/GlobalListenerCoordinator.js`)
- Consolidates duplicate real-time listeners across the app
- **Real-time listeners are currently DISABLED** (`REALTIME_LISTENERS_ENABLED = false`)
- App relies on overview/cache documents instead of collection listeners
- Use this service for any future listener needs to avoid duplicate subscriptions

#### Overview Documents Pattern
The app uses Cloud Functions to maintain "overview" documents that aggregate collection data:

**Cloud Functions** (`functions/index.js`):
- `syncAuctionOverview` - Maintains `auctionOverviews/{groupId}` with auction summaries
- `syncCardOverview` - Maintains `cardOverviews/{groupId}_{ownerId}` with card summaries
- These overview docs update automatically on write operations
- Clients read ONE document instead of querying entire collections

**Benefits**:
- 1 read for entire auction list vs N reads (one per auction)
- 1 read for user's card collection vs N reads (one per card)
- Guaranteed read budget compliance

#### CacheService (`src/services/caching/CacheService.js`)
- In-memory cache layer for frequently accessed data
- Supports TTL (time-to-live) for cache invalidation
- Use for any data that doesn't need to be real-time

### Context System

#### UnifiedUserDataContext (`src/contexts/UnifiedUserDataContext.js`)
**Purpose**: Consolidates user-related data into a single listener to avoid duplicate reads of the user document.

**Provides**:
- User balance (coins)
- User gems
- Profile data (username, avatar, level, XP)
- Transaction batching for balance operations

**Key Methods**:
- `spendCoins(amount, context)` - Deduct coins with validation
- `awardCoins(amount, context)` - Add coins with validation
- `spendGems(amount, context)` - Deduct gems
- `awardGems(amount, context)` - Add gems

**Important**: All balance operations are batched and validated. Never directly update Firestore balance fields.

#### GroupContext (`src/contexts/GroupContext.js`)
- Manages current group selection
- Groups are the primary data isolation boundary in the app
- Most data is scoped by groupId (cards, auctions, trades, leaderboards)

### Services Architecture

#### Auction System
- `AuctionService.js` - Core auction operations (create, bid, etc.)
- `AuctionCompletionService.js` - Handles auction end state
- `BackgroundAuctionCompletionService.js` - Background processing for expired auctions
- `AuctionStatusManager.js` - Manages auction lifecycle states
- `UltraEfficientAuctionService.js` - Optimized queries with caching
- `ConsolidatedBidService.js` - Batches bid operations

**Live Rarity System**:
- Auctions have dynamic rarity that changes based on bid activity
- `ConsolidatedRarityService.js` - Calculates rarity in real-time
- `src/utils/auctionRarity.js` - Rarity calculation utilities

#### Data Management
- `UltraBatchService.js` - Batches write operations to reduce costs
- `DataManager.js` - Central data operations coordinator
- `GlobalRequestDeduplicator.js` - Prevents duplicate in-flight requests
- `GlobalUserProfileCache.js` - Caches user profile data
- `GlobalGroupCache.js` - Caches group metadata

#### Monitoring & Performance
- `ProductionMonitor.js` - Tracks read operations in production
- `ReadMonitor.js` - Development-time read tracking
- `ReadCircuitBreaker.js` - Auto-disables features if read budget exceeded
- `BootPerformanceMonitor.js` - Tracks app startup performance

### Hooks

#### Data Fetching Hooks
- `useConsolidatedUserData.js` - User data from UnifiedUserDataContext
- `useUltraOptimizedCollectionData.js` - User's card collection with caching
- `useUltraSimpleAuctionData.js` - Auction data using overview docs
- `useOptimizedBidding.js` - Bidding logic with validation
- `useOptimizedTradeData.js` - Trade listings with caching

#### Feature Hooks
- `useSmartStatusVerification.js` - Verifies entity status without excessive reads
- `useBidding.js` - Bidding UI state management
- `useAuctionCompletion.js` - Handle auction completion flows

### State Management

**Zustand Stores** (`src/store/`):
- `useInitialStore.js` - Bootstrap payload storage
- Minimal Zustand usage; most state in React Context

### Important Patterns

#### Balance Operations
Always use UnifiedUserDataContext methods:
```javascript
const { spendCoins, awardCoins, userData } = useUnifiedUserData();

// Correct
await spendCoins(100, 'auction_bid');

// Wrong - Never do this
await updateDoc(userRef, { coins: increment(-100) });
```

#### Firestore Reads
Always use TrackedFirestore:
```javascript
// Correct
import { getDoc } from '../services/ReadTracking/TrackedFirestore';

// Wrong
import { getDoc } from 'firebase/firestore';
```

#### Collection Queries
Prefer overview documents over collection queries:
```javascript
// Correct - Single read
const overviewDoc = await getDoc(doc(db, 'auctionOverviews', groupId));
const auctions = overviewDoc.data()?.auctions || [];

// Wrong - N reads (one per auction)
const snapshot = await getDocs(query(collection(db, 'auctions'), where('groupId', '==', groupId)));
```

#### Real-time Updates
Do NOT create new listeners. Use RefreshCoordinator or pull-to-refresh:
```javascript
// Correct - Use overview docs + manual refresh
const refreshData = async () => {
  const overviewDoc = await getDoc(doc(db, 'auctionOverviews', groupId));
  setAuctions(overviewDoc.data()?.auctions || []);
};

// Wrong - Real-time listener (disabled in app)
onSnapshot(query(collection(db, 'auctions')), ...);
```

### Dev Tools

**ReadDashboard** (`src/components/DevTools/ReadDashboard.js`):
- Visible in `__DEV__` mode only
- Shows real-time read count and breakdown by source
- Press to expand and see detailed metrics

### Database Structure

**Key Collections**:
- `users/{userId}` - User profiles and balance
- `users/{userId}/sessions/main` - Active session data (balance operations happen here)
- `cards/{cardId}` - Individual card documents
- `cardOverviews/{groupId}_{userId}` - Aggregated card summaries (use this!)
- `auctions/{auctionId}` - Individual auction documents
- `auctionOverviews/{groupId}` - Aggregated auction summaries (use this!)
- `trades/{tradeId}` - Trade offers
- `groups/{groupId}` - Group metadata
- `initialAppLoad/{userId}_{groupId}` - Bootstrap data document

### Testing Strategy

- Jest configured for React Native
- Test files should be co-located with source files or in `__tests__` directories
- When writing tests, mock Firebase operations to avoid actual reads

### Firebase Configuration

- `firebase.json` - Emulator ports: Firestore (8082), Functions (5001)
- `firestore.rules` - Security rules (keep these in sync with data model changes)
- `firestore.indexes.json` - Composite indexes for queries

### Common Gotchas

1. **Never query collections directly** - Use overview documents maintained by Cloud Functions
2. **Always use TrackedFirestore** - Raw Firebase SDK calls won't be monitored
3. **Balance operations must go through UnifiedUserDataContext** - Direct Firestore updates will cause race conditions
4. **Real-time listeners are disabled** - Don't create new onSnapshot calls
5. **Time drift awareness** - Auctions use server time to prevent client-side manipulation (see `src/utils/timeUtils.js`)
6. **Card download feature is disabled** - UI buttons removed, don't re-enable without discussion

### Key Files to Understand First

1. `App.js` - Provider hierarchy and bootstrap flow
2. `src/contexts/UnifiedUserDataContext.js` - Central user data management
3. `src/services/ReadTracking/TrackedFirestore.js` - Read monitoring wrapper
4. `src/bootstrap/useInitialLoad.js` - Bootstrap data loading
5. `functions/index.js` - Cloud Functions maintaining overview documents
6. `src/utils/GlobalListenerCoordinator.js` - Listener consolidation

### TypeScript

- Project uses TypeScript for config and types (`tsconfig.json`)
- Type definitions in `src/types/` (card.ts, group.ts, navigation.ts)
- Firebase config is in TypeScript (`src/config/firebase.ts`)
- Most app code is still JavaScript, migrate incrementally

### Performance Budget

**Target**: < 10 Firestore reads per user session
**Current**: Optimized for single-digit reads via overview documents and aggressive caching
**Monitoring**: ProductionMonitor samples 10% of sessions and alerts on budget violations
