# Production Logging Migration Guide

## Overview

The codebase now includes a production-ready logging framework (`src/utils/logger.js`) that replaces console.log statements with proper logging levels and environment-based configuration.

## Quick Migration Examples

### Before (console.log)
```javascript
console.log('User authenticated:', userId);
console.log('Loading auction data...', auctionId);
console.error('Error fetching data:', error);
console.warn('Cache miss for key:', key);
```

### After (Production Logger)
```javascript
import { info, warn, error, debug } from '../utils/logger';

// Basic logging
info('User authenticated', { userId });
debug('Loading auction data', { auctionId });
error('Error fetching data', error, { component: 'AuctionService' });
warn('Cache miss for key', { key, ttl: 300 });
```

## Migration Steps

### Step 1: Add Logger Import
```javascript
// Add to top of file
import { info, warn, error, debug } from '../utils/logger';
```

### Step 2: Replace Console Statements

| Old Pattern | New Pattern |
|------------|-------------|
| `console.log(...)` | `info(...)` or `debug(...)` |
| `console.info(...)` | `info(...)` |
| `console.warn(...)` | `warn(...)` |
| `console.error(...)` | `error(...)` |

### Step 3: Add Context Information
```javascript
// Instead of:
console.log('Auction completed');

// Use:
info('Auction completed', null, { 
  component: 'AuctionService',
  operation: 'completeAuction',
  auctionId 
});
```

## Log Levels Explained

- **DEBUG**: Development-only information (automatically filtered in production)
- **INFO**: General information about app flow
- **WARN**: Warning conditions that don't halt execution  
- **ERROR**: Error conditions that need attention

## Advanced Usage

### Structured Logging
```javascript
info('User action completed', {
  action: 'purchase',
  itemId: 'card_123',
  cost: 50,
  userId
}, {
  component: 'Store',
  operation: 'purchaseCard'
});
```

### Performance Logging
```javascript
const startTime = Date.now();
// ... operation ...
debug('Operation completed', {
  duration: Date.now() - startTime,
  recordsProcessed: results.length
}, {
  component: 'DatabaseService',
  operation: 'batchUpdate'
});
```

### Error Logging with Context
```javascript
try {
  // ... operation ...
} catch (err) {
  error('Database operation failed', err, {
    component: 'AuctionService',
    operation: 'placeBid',
    userId,
    auctionId,
    bidAmount
  });
  throw err;
}
```

## Configuration

The logger automatically adjusts based on environment:

- **Development**: All logs to console (DEBUG level and above)
- **Production**: Only WARN and ERROR to remote logging (DEBUG filtered out)

### Environment Variables
```javascript
// In production configuration
__DEV__ = false; // Automatically disables console output
```

## Files Already Updated

- `src/utils/logger.js` - Production logging framework
- `src/services/AuctionService.js` - Logger import added (ready for migration)

## Files Needing Migration

Based on the audit, the following files contain console.log statements that should be migrated:

### High Priority (Core Services)
- All files in `src/services/` directory
- `src/hooks/` directory files
- `src/contexts/` directory files

### Medium Priority (Utilities)
- All files in `src/utils/` directory (many files)
- Cache management utilities
- Performance monitoring utilities

### Low Priority (Components/Screens)
- UI components with debug logging
- Screen components with user action logging

## Benefits of Migration

1. **Production Safety**: No console output in production builds
2. **Remote Logging**: Automatic error reporting in production
3. **Structured Data**: Consistent log format for analysis
4. **Performance**: Filtered logging reduces overhead
5. **Debugging**: Better context and component identification

## Quick Legacy Support

For quick migration, you can also use the legacy `log` function:

```javascript
import { log } from '../utils/logger';

// Minimal change from console.log
log('Simple message');
log('Message with data', { key: 'value' });
```

This will automatically convert to `info` level logging with the new system. 