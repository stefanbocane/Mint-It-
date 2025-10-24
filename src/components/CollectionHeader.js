import { useNavigation } from '@react-navigation/native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Button, Chip, Menu, Surface } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { CARD_COLLECTION_LIMIT } from '../utils/cardLimits';

const CollectionHeader = ({
  balance,
  userGems,
  cards,
  sortBy,
  setSortBy,
  sortOrder,
  setSortOrder,
  filterStatus,
  setFilterStatus,
  sortByMenuVisible,
  setSortByMenuVisible,
  sortOrderMenuVisible,
  setSortOrderMenuVisible,
  filterStatusMenuVisible,
  setFilterStatusMenuVisible
}) => {
  const navigation = useNavigation();

  // Short labels for compact display
  const getShortSortLabel = (sortBy) => {
    switch(sortBy) {
      case 'name': return 'Name';
      case 'rarity': return 'Rarity';
      case 'dateAdded': return 'Date';
      default: return sortBy;
    }
  };

  const getShortStatusLabel = (status) => {
    switch(status) {
      case 'all': return 'All';
      case 'available': return 'Available';
      case 'inTrade': return 'Trading';
      case 'inAuction': return 'Auction';
      default: return status;
    }
  };

  return (
    <Surface style={styles.headerSurface} elevation={0}>
      <View style={styles.header}>
        <View style={styles.collectionStats}>
          <Text style={styles.statsText}>
            <Text style={[
              styles.statsCount, 
              cards.length >= CARD_COLLECTION_LIMIT ? styles.statsCountLimit : null
            ]}>
              {cards.length}
            </Text>
            <Text style={styles.statsLimit}>/{CARD_COLLECTION_LIMIT}</Text> Cards
          </Text>
          {cards.length >= CARD_COLLECTION_LIMIT && (
            <Chip 
              icon="alert" 
              style={styles.limitWarningChip}
              textStyle={styles.limitWarningText}
              compact
            >
              Limit Reached
            </Chip>
          )}
        </View>

        {/* Sets Button */}
        <View style={styles.setsButtonContainer}>
          <Button
            mode="contained"
            onPress={() => navigation.navigate('Sets')}
            icon="trophy"
            style={styles.setsButton}
            contentStyle={styles.setsButtonContent}
            compact
          >
            Sets & Trophies
          </Button>
        </View>
        
        {/* Improved Filter Row */}
        <View style={styles.filterRow}>
          <Menu
            visible={sortByMenuVisible}
            onDismiss={() => setSortByMenuVisible(false)}
            anchor={
              <TouchableOpacity 
                style={styles.sortFilterButton}
                onPress={() => setSortByMenuVisible(true)}
              >
                <Icon name="sort" size={16} color="#333" />
                <Text style={styles.filterButtonText}>{getShortSortLabel(sortBy)}</Text>
                <Icon name="chevron-down" size={16} color="#333" />
              </TouchableOpacity>
            }
          >
            <Menu.Item 
              onPress={() => { setSortBy('name'); setSortByMenuVisible(false); }} 
              title="Name" 
              leadingIcon="sort-alphabetical-ascending"
            />
            <Menu.Item 
              onPress={() => { setSortBy('rarity'); setSortByMenuVisible(false); }} 
              title="Rarity" 
              leadingIcon="diamond-stone"
            />
            <Menu.Item 
              onPress={() => { setSortBy('dateAdded'); setSortByMenuVisible(false); }} 
              title="Date Added" 
              leadingIcon="calendar"
            />
          </Menu>
          
          <Menu
            visible={sortOrderMenuVisible}
            onDismiss={() => setSortOrderMenuVisible(false)}
            anchor={
              <TouchableOpacity 
                style={styles.orderFilterButton}
                onPress={() => setSortOrderMenuVisible(true)}
              >
                <Icon name={sortOrder === 'asc' ? 'arrow-up' : 'arrow-down'} size={16} color="#333" />
                <Text style={styles.orderButtonText}>{sortOrder === 'asc' ? 'Ascending' : 'Descending'}</Text>
                <Icon name="chevron-down" size={16} color="#333" />
              </TouchableOpacity>
            }
          >
            <Menu.Item 
              onPress={() => { setSortOrder('asc'); setSortOrderMenuVisible(false); }} 
              title="Ascending" 
              leadingIcon="arrow-up"
            />
            <Menu.Item 
              onPress={() => { setSortOrder('desc'); setSortOrderMenuVisible(false); }} 
              title="Descending" 
              leadingIcon="arrow-down"
            />
          </Menu>
          
          <Menu
            visible={filterStatusMenuVisible}
            onDismiss={() => setFilterStatusMenuVisible(false)}
            anchor={
              <TouchableOpacity 
                style={styles.statusFilterButton}
                onPress={() => setFilterStatusMenuVisible(true)}
              >
                <Icon name="filter-variant" size={16} color="#333" />
                <Text style={styles.filterButtonText}>{getShortStatusLabel(filterStatus)}</Text>
                <Icon name="chevron-down" size={16} color="#333" />
              </TouchableOpacity>
            }
          >
            <Menu.Item 
              onPress={() => { setFilterStatus('all'); setFilterStatusMenuVisible(false); }} 
              title="All" 
              leadingIcon="cards"
            />
            <Menu.Item 
              onPress={() => { setFilterStatus('available'); setFilterStatusMenuVisible(false); }} 
              title="Available" 
              leadingIcon="check-circle"
            />
            <Menu.Item 
              onPress={() => { setFilterStatus('inTrade'); setFilterStatusMenuVisible(false); }} 
              title="In Trade" 
              leadingIcon="account-switch"
            />
            <Menu.Item 
              onPress={() => { setFilterStatus('inAuction'); setFilterStatusMenuVisible(false); }} 
              title="In Auction" 
              leadingIcon="gavel"
            />
          </Menu>
        </View>
      </View>
    </Surface>
  );
};

const styles = StyleSheet.create({
  headerSurface: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  header: {
    padding: 12,
  },
  collectionStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  statsText: {
    fontSize: 16,
  },
  statsCount: {
    fontWeight: 'bold',
    fontSize: 20,
  },
  statsCountLimit: {
    fontWeight: 'bold',
    fontSize: 20,
    color: 'crimson',
  },
  statsLimit: {
    fontSize: 14,
    opacity: 0.7,
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 4,
  },
  sortFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
    minHeight: 36,
  },
  orderFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    flex: 1.2,
    justifyContent: 'center',
    minWidth: 0,
    minHeight: 36,
  },
  statusFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
    minHeight: 36,
  },
  filterButtonText: {
    fontSize: 14,
    marginHorizontal: 4,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  setsButtonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  setsButton: {
    flex: 1,
    marginHorizontal: 2,
  },
  setsButtonContent: {
    justifyContent: 'center',
    paddingVertical: 2,
  },
  balanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  balanceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  balanceText: {
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  limitWarningChip: {
    backgroundColor: 'orange',
    height: 28,
  },
  limitWarningText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 10,
  },
  orderButtonText: {
    fontSize: 14,
    marginHorizontal: 4,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
});

export default CollectionHeader; 