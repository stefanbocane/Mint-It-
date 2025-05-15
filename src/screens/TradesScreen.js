import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, limit, query, startAfter, where } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Button, Card, Divider, FAB, SegmentedButtons, Text, useTheme } from 'react-native-paper';
import ScreenBackground from '../components/ScreenBackground';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { GROUP_CHANGED_EVENT, useGroup } from '../contexts/GroupContext';
import { clearExpiredCache } from '../utils/cacheUtils';
import EventManager from '../utils/eventManager';

const TradesScreen = () => {
  const theme = useTheme();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const [trades, setTrades] = useState([]);
  const [filteredTrades, setFilteredTrades] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unsubscribeListeners, setUnsubscribeListeners] = useState([]);
  const [filterStatus, setFilterStatus] = useState('active');
  const [displayedTradeCount, setDisplayedTradeCount] = useState(10);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreTrades, setHasMoreTrades] = useState(true);
  const [lastDoc, setLastDoc] = useState(null);
  const unsubscribeListenersRef = useRef([]);
  const [error, setError] = useState(null);
  
  // Clean up cache when component mounts
  useEffect(() => {
    clearExpiredCache().then(count => {
      console.log(`Cleared ${count} expired cache entries on TradesScreen mount`);
    });
    
    // Clean up listeners on unmount
    return () => {
      if (unsubscribeListenersRef.current.length > 0) {
        console.log('Cleaning up all trade listeners');
        unsubscribeListenersRef.current.forEach(unsub => {
          if (typeof unsub === 'function') {
            unsub();
          }
        });
        unsubscribeListenersRef.current = [];
      }
    };
  }, []);
  
  // Modify fetchTrades to support pagination
  const fetchTrades = async (isInitial = true) => {
    if (!user || !currentGroup) {
      console.log('Skipping fetchTrades - missing user or group');
      return;
    }
    
    try {
      setRefreshing(isInitial);
      if (isInitial) {
        setLoading(true);
        setError(null); // Clear any previous errors when starting a fresh fetch
      }
      
      console.log(`Starting fetchTrades (isInitial: ${isInitial}), group: ${currentGroup.id}, user: ${user.uid}`);
      
      const tradesRef = collection(db, 'trades');
      
      // Create query for trades the user is participating in - with pagination
      const pageSize = 10;
      let participatingQuery;
      
      try {
        if (isInitial) {
          // Initial query with simpler approach - first just check if the user has any trades at all
          console.log('Creating initial query for trades');
          participatingQuery = query(
            tradesRef,
            where('groupId', '==', currentGroup.id),
            where('participants', 'array-contains', user.uid),
            limit(pageSize)
          );
        } else if (lastDoc) {
          // Paginated query - we'll sort client-side if needed
          console.log('Creating pagination query for trades starting after', lastDoc.id);
          participatingQuery = query(
            tradesRef,
            where('groupId', '==', currentGroup.id),
            where('participants', 'array-contains', user.uid),
            startAfter(lastDoc),
            limit(pageSize)
          );
        } else {
          // No more documents to load
          console.log('No lastDoc available for pagination, skipping fetch');
          setIsLoadingMore(false);
          setHasMoreTrades(false);
          return;
        }
        
        console.log('Executing trades query...');
        const tradeSnapshot = await getDocs(participatingQuery);
        console.log(`Query returned ${tradeSnapshot.docs.length} trades`);
        
        if (tradeSnapshot.empty) {
          console.log('No trades found for this user in this group');
          if (isInitial) {
            setTrades([]);
            setFilteredTrades([]);
          }
          setHasMoreTrades(false);
          setRefreshing(false);
          setLoading(false);
          setIsLoadingMore(false);
          return;
        }
        
        // Update last document for pagination
        const lastVisible = tradeSnapshot.docs[tradeSnapshot.docs.length - 1];
        setLastDoc(lastVisible);
        setHasMoreTrades(tradeSnapshot.docs.length === pageSize);
        
        // Process trades with additional info
        const tradesData = tradeSnapshot.docs.map(doc => {
          const data = doc.data();
          
          // Ensure we have valid dates
          const createdAt = data.createdAt?.toDate?.() || new Date();
          const updatedAt = data.updatedAt?.toDate?.() || new Date();
          
          // Add derived properties to make rendering easier
          return {
            id: doc.id,
            ...data,
            createdAt,
            updatedAt,
            // Add flag for easier rendering logic
            isSender: data.senderId === user.uid,
            // Ensure we have these fields to prevent UI errors
            senderName: data.senderName || 'Unknown User',
            receiverName: data.receiverName || 'Unknown User',
            offeredCards: data.offeredCards || [],
            requestedCards: data.requestedCards || [],
            status: data.status || 'pending',
            participants: data.participants || []
          };
        });
        
        // Sort by most recent updates first
        tradesData.sort((a, b) => b.updatedAt - a.updatedAt);
        
        console.log(`Processed ${tradesData.length} trades with IDs:`, tradesData.map(t => t.id));
        
        if (isInitial) {
          // Replace existing trades
          console.log('Setting initial trades array');
          setTrades(tradesData);
        } else {
          // Append to existing trades
          console.log('Appending to existing trades array');
          setTrades(prev => [...prev, ...tradesData]);
        }
      } catch (innerQueryError) {
        console.error('Error with main query:', innerQueryError.message);
        
        // Try a super simple query as a last resort
        try {
          console.log('Attempting simple fallback query');
          const fallbackQuery = query(
            tradesRef,
            where('groupId', '==', currentGroup.id),
            limit(pageSize)
          );
          
          const fallbackSnapshot = await getDocs(fallbackQuery);
          console.log(`Super simple fallback query returned ${fallbackSnapshot.docs.length} trades`);
          
          // Filter manually to find the user's trades
          const userTrades = fallbackSnapshot.docs.filter(doc => {
            const data = doc.data();
            return data.participants && data.participants.includes(user.uid);
          });
          
          console.log(`After manual filtering: ${userTrades.length} trades belong to this user`);
          
          if (userTrades.length > 0) {
            // Process trades
            const fallbackData = userTrades.map(doc => {
              const data = doc.data();
              return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate?.() || new Date(),
                updatedAt: data.updatedAt?.toDate?.() || new Date(),
                isSender: data.senderId === user.uid,
                senderName: data.senderName || 'Unknown User',
                receiverName: data.receiverName || 'Unknown User',
                offeredCards: data.offeredCards || [],
                requestedCards: data.requestedCards || [],
                status: data.status || 'pending'
              };
            });
            
            // Sort manually
            fallbackData.sort((a, b) => b.updatedAt - a.updatedAt);
            
            if (isInitial) {
              setTrades(fallbackData);
            } else {
              setTrades(prev => [...prev, ...fallbackData]);
            }
            
            setHasMoreTrades(false); // Can't paginate with this approach
          } else {
            // No trades found even with the simplest query
            if (isInitial) {
              setTrades([]);
            }
          }
        } catch (fallbackError) {
          console.error('All fallback queries failed:', fallbackError);
          setError(`Could not load trades: ${fallbackError.message || 'Unknown error'}`);
          if (isInitial) {
            setTrades([]);
          }
        }
      }
      
      setRefreshing(false);
      setLoading(false);
      setIsLoadingMore(false);
    } catch (error) {
      console.error('Error fetching trades:', error);
      
      // Log more detailed error information
      if (error.code) {
        console.error(`Firestore error code: ${error.code}`);
      }
      
      if (error.name === 'FirebaseError') {
        console.error('Firebase specific error:', error.message);
      }
      
      // Set error state with a user-friendly message
      setError(`Failed to load trades: ${error.message || 'Unknown error'}`);
      
      // Handle gracefully - set empty trades and continue
      if (isInitial) {
        setTrades([]);
      }
      
      setRefreshing(false);
      setLoading(false);
      setIsLoadingMore(false);
    }
  };

  // Handle loading more trades
  const handleLoadMore = () => {
    if (isLoadingMore || !hasMoreTrades) return;
    
    setIsLoadingMore(true);
    fetchTrades(false);
  };

  // Update onRefresh to reset pagination
  const onRefresh = async () => {
    setLastDoc(null);
    setHasMoreTrades(true);
    await fetchTrades(true);
  };

  // Filter trades based on filter status
  useEffect(() => {
    if (!trades || trades.length === 0) {
      console.log('No trades to filter - setting empty filtered trades array');
      setFilteredTrades([]);
      return;
    }

    console.log(`Filtering ${trades.length} trades with status filter: ${filterStatus}`);
    const filtered = trades.filter(trade => {
      if (filterStatus === 'active') {
        return ['pending', 'offered', 'active'].includes(trade.status);
      } else {
        return ['completed', 'rejected', 'canceled'].includes(trade.status);
      }
    });

    console.log(`After filtering: ${filtered.length} trades match the '${filterStatus}' filter`);
    setFilteredTrades(filtered);
  }, [trades, filterStatus]);

  // Add effect to fetch trades when group changes
  useEffect(() => {
    if (user && currentGroup) {
      console.log(`Fetching trades for user ${user.uid} in group ${currentGroup.id}`);
      fetchTrades(true);
    } else {
      console.log('Not fetching trades - missing user or group:', { hasUser: !!user, hasGroup: !!currentGroup });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps  
  }, [user, currentGroup]);
  
  // Add event listener for group changes
  useEffect(() => {
    // Subscribe to the group change event
    const subscription = EventManager.subscribe(GROUP_CHANGED_EVENT, (event) => {
      console.log('Group changed event detected in Trades screen');
      if (user && currentGroup && event.groupId === currentGroup.id) {
        // Reset pagination and fetch new trades
        setLastDoc(null);
        setHasMoreTrades(true);
        fetchTrades(true);
      }
    });
    
    // Clean up subscription
    return () => {
      EventManager.unsubscribe(subscription);
    };
  }, [user, currentGroup]);

  // Render a trade card
  const renderTradeItem = ({ item }) => {
    // Safety check to handle null or undefined items
    if (!item) {
      console.warn('Received null or undefined item in renderTradeItem');
      return null;
    }
    
    // Log item data in debug mode
    if (__DEV__) {
      console.log('Rendering trade item:', {
        id: item.id,
        status: item.status,
        sender: item.senderName,
        receiver: item.receiverName
      });
    }
    
    return (
      <Card style={styles.tradeCard} mode="elevated">
        <Card.Content>
          <View style={styles.tradeHeader}>
            <Text style={styles.tradeTitle}>
              {item.isSender ? 
                `To: ${item.receiverName || 'Unknown'}` : 
                `From: ${item.senderName || 'Unknown'}`}
            </Text>
            <Text 
              style={[
                styles.statusText,
                { color: getStatusColor(item.status).textColor }
              ]}
            >
              {getStatusLabel(item.status)}
            </Text>
          </View>
          
          <Divider style={styles.divider} />
          
          <View style={styles.cardsInfoContainer}>
            <View style={styles.cardCountContainer}>
              <Text style={styles.cardCountLabel}>Offered:</Text>
              <View style={styles.cardCount}>
                <MaterialCommunityIcons name="cards" size={14} color="#666" />
                <Text style={styles.cardCountText}>
                  {item.offeredCards?.length || 0}
                </Text>
              </View>
            </View>
            
            <View style={styles.cardCountContainer}>
              <Text style={styles.cardCountLabel}>Requested:</Text>
              <View style={styles.cardCount}>
                <MaterialCommunityIcons name="cards-outline" size={14} color="#666" />
                <Text style={styles.cardCountText}>
                  {item.requestedCards?.length || 0}
                </Text>
              </View>
            </View>
          </View>
          
          <Divider style={styles.divider} />
          
          <Button 
            mode="contained" 
            onPress={() => navigation.navigate('TradeDetails', { tradeId: item.id })}
            style={styles.viewButton}
          >
            View Details
          </Button>
        </Card.Content>
      </Card>
    );
  };

  // Get status label for display
  const getStatusLabel = (status) => {
    const labels = {
      pending: 'Pending',
      offered: 'Offered',
      active: 'Active',
      completed: 'Completed',
      rejected: 'Rejected',
      canceled: 'Canceled'
    };
    
    return labels[status] || 'Pending';
  };

  // Get status color for UI
  const getStatusColor = (status) => {
    const colors = {
      pending: { 
        textColor: '#FFA000'
      },
      offered: { 
        textColor: '#1976D2'
      },
      active: { 
        textColor: '#388E3C'
      },
      completed: { 
        textColor: '#388E3C'
      },
      rejected: { 
        textColor: '#D32F2F'
      },
      canceled: { 
        textColor: '#757575'
      }
    };
    
    return colors[status] || colors.pending;
  };

  const renderEmptyList = () => (
    <View style={styles.emptyContainer}>
      {!currentGroup ? (
        <Text style={styles.emptyText}>Please select a group first</Text>
      ) : (
        <>
          <MaterialCommunityIcons name="cards-outline" size={64} color={theme.colors.primary} style={styles.emptyIcon} />
          <Text style={styles.emptyText}>No trades found</Text>
          <Text style={styles.emptySubtext}>
            {filterStatus === 'active' 
              ? 'Start trading cards with your group members!' 
              : 'No completed trades yet'}
          </Text>
          <Button 
            mode="contained"
            onPress={() => navigation.navigate('CreateTrade')}
            style={styles.createButton}
          >
            Create New Trade
          </Button>
        </>
      )}
    </View>
  );

  // Reset error state and retry loading
  const handleRetry = () => {
    setError(null);
    onRefresh();
  };

  return (
    <ScreenBackground>
      <View style={styles.container}>
        {/* Trade status filter */}
        <SegmentedButtons
          value={filterStatus}
          onValueChange={setFilterStatus}
          style={styles.segmentedButtons}
          buttons={[
            {
              value: 'active',
              label: 'Active',
            },
            {
              value: 'completed',
              label: 'Completed',
            },
          ]}
        />
        
        {/* Debug info in dev mode */}
        {__DEV__ && (
          <View style={{ padding: 5, backgroundColor: 'rgba(0,0,0,0.05)' }}>
            <Text style={{ fontSize: 10 }}>
              Trades: {trades.length}, Filtered: {filteredTrades?.length || 0}, 
              Loading: {loading ? 'Yes' : 'No'}, Status: {filterStatus}
            </Text>
          </View>
        )}
        
        {/* Error state */}
        {error && (
          <View style={styles.errorContainer}>
            <MaterialCommunityIcons name="alert-circle-outline" size={64} color="#D32F2F" />
            <Text style={styles.errorTitle}>Error Loading Trades</Text>
            <Text style={styles.errorMessage}>{error}</Text>
            <Button 
              mode="contained" 
              onPress={handleRetry}
              style={styles.retryButton}
            >
              Retry
            </Button>
          </View>
        )}
        
        {/* Loading spinner */}
        {loading && !error && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={styles.loadingText}>Loading trades...</Text>
          </View>
        )}
        
        {/* Trade list - only show if no error */}
        {!error && (
          <FlatList
            data={filteredTrades || []}
            renderItem={renderTradeItem}
            keyExtractor={item => item?.id || Math.random().toString()}
            contentContainerStyle={[
              styles.tradesList,
              (!filteredTrades || filteredTrades.length === 0) && styles.emptyList
            ]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[theme.colors.primary]}
              />
            }
            ListEmptyComponent={!loading && renderEmptyList()}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              isLoadingMore ? (
                <View style={styles.loadingMore}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                  <Text style={styles.loadingMoreText}>Loading more...</Text>
                </View>
              ) : null
            }
          />
        )}
        
        {currentGroup && (
          <FAB
            style={[styles.fabStyle, { backgroundColor: theme.colors.primary }]}
            icon="plus"
            onPress={() => navigation.navigate('CreateTrade')}
          />
        )}
      </View>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 8,
  },
  segmentedButtons: {
    marginHorizontal: 8,
    marginVertical: 8,
  },
  tradeCard: {
    marginBottom: 10,
    backgroundColor: 'white',
    elevation: 2,
  },
  tradeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tradeTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  divider: {
    marginVertical: 8,
  },
  cardsInfoContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  cardCountContainer: {
    alignItems: 'center',
  },
  cardCountLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  cardCount: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardCountText: {
    marginLeft: 4,
    fontSize: 14,
  },
  viewButton: {
    marginTop: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  tradesList: {
    padding: 8,
    paddingBottom: 80, // Extra space for FAB
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginVertical: 8,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  createButton: {
    marginTop: 16,
  },
  loadingMore: {
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingMoreText: {
    marginLeft: 8,
    color: '#666',
  },
  fabStyle: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    marginTop: 16,
  },
});

export default TradesScreen; 