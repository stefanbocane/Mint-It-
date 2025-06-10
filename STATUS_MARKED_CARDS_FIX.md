# Status Marked Cards Fix - Collection Screen Preview Restriction

## 🎯 **Issue Description**
Status marked cards were showing as ownable/downloadable in the collection screen card previews when they should be restricted from ownership operations.

## ✅ **Solution Implemented**

### **1. Added Card Restriction Validation**
- **File**: `src/components/CardPreviewModal.js`
- **Import**: Added `isCardDownloadable`, `canUserOwnCard`, and `getCardRestrictionMessage` from `cardUtils.js`
- **Validation**: Added ownership status check using existing utility functions

### **2. Modified Action Buttons Logic**
- **Own Card Button**: Now only shows for cards that pass `canUserOwnCard()` and `isCardDownloadable()` checks
- **Trade/Auction Buttons**: Also restricted for status marked cards
- **Download Button**: Added restriction check for cards in trade/auction
- **Restricted Button**: Shows "Restricted" button with explanation message for status marked cards

### **3. Enhanced User Experience**
- **Clear Messaging**: Users see "Restricted" button instead of confusing enabled buttons
- **Explanation**: Tapping restricted button shows appropriate restriction message
- **Prevention**: Functions now check restrictions before executing actions

## 🔧 **Technical Implementation**

### **Card Status Check**
```javascript
// Check if card can be owned
const cardOwnershipStatus = canUserOwnCard(card, { uid: 'user' });
const canOwnCard = cardOwnershipStatus.canOwn && isCardDownloadable(card);
```

### **Conditional Button Rendering**
```javascript
{canOwnCard ? (
  <Button onPress={ownCard}>Own (+{getSellPrice(card.rarity)})</Button>
) : (
  <Button onPress={showRestrictionMessage}>Restricted</Button>
)}
```

### **Function-Level Validation**
```javascript
const ownCard = async () => {
  if (!canOwnCard) {
    Alert.alert('Card Not Available', getCardRestrictionMessage(card));
    return;
  }
  // ... rest of function
};
```

## 🚫 **Restricted Card Types**

The following card statuses are now properly restricted from ownership:

1. **Status Marked Cards** (`status: 'marked'` or `isMarked: true`)
2. **Flagged Cards** (`status: 'flagged'` or `isFlagged: true`)
3. **Suspended Cards** (`status: 'suspended'`)
4. **Banned Cards** (`status: 'banned'`)
5. **Pending Cards** (`status: 'pending'`)
6. **Locked Cards** (`status: 'locked'` or `isLocked: true`)
7. **Restricted Cards** (`isRestricted: true`)

## 📱 **User Interface Changes**

### **Before Fix:**
- All cards showed "Own Card" button regardless of status
- Users could attempt to own status marked cards
- Confusing experience for restricted cards

### **After Fix:**
- Status marked cards show "Restricted" button
- Clear indication of card availability
- Appropriate error messages when restrictions apply
- Trade/Auction buttons also respect restrictions

## 🎨 **New Button Styles**

```javascript
restrictedButton: {
  borderColor: '#FF5722',
  marginBottom: 6,
  flex: 1,
  minHeight: 40,
},
restrictedButtonLabel: {
  fontSize: 12,
  color: '#FF5722',
}
```

## ✅ **Testing Checklist**

- [ ] Status marked cards show "Restricted" button
- [ ] Flagged cards show "Restricted" button
- [ ] Suspended/banned cards show "Restricted" button
- [ ] Available cards show normal "Own Card" button
- [ ] Restriction messages are appropriate and clear
- [ ] Trade/Auction buttons respect restrictions
- [ ] Download functionality respects restrictions
- [ ] No console errors or crashes

## 🔄 **Backward Compatibility**

- ✅ Existing card display functionality preserved
- ✅ Normal cards continue to work as expected
- ✅ No breaking changes to card data structure
- ✅ Uses existing utility functions from `cardUtils.js`

## 📈 **Impact**

### **Security:**
- ✅ Prevents unauthorized access to restricted cards
- ✅ Enforces proper card status restrictions

### **User Experience:**
- ✅ Clear visual indication of card restrictions
- ✅ Appropriate error messaging
- ✅ Consistent behavior across the app

### **Maintainability:**
- ✅ Uses centralized utility functions
- ✅ Consistent restriction logic
- ✅ Easy to add new restriction types

## 🔗 **Related Files**

- `src/components/CardPreviewModal.js` - Main implementation
- `src/utils/cardUtils.js` - Restriction utility functions
- `src/utils/cardStyleUtils.js` - Card status badge utilities
- `src/screens/CollectionScreen.js` - Collection screen context

**Status**: ✅ **IMPLEMENTED AND READY FOR TESTING** 