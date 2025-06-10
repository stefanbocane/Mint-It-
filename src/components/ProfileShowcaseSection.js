import { useState } from 'react';
import { Dimensions, FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Button, Modal, Portal, Text, useTheme } from 'react-native-paper';
import SimpleCardImage from './SimpleCardImage';

const { width } = Dimensions.get('window');
const CARD_MARGIN = 10;
const CARD_WIDTH = (width - (CARD_MARGIN * 6)) / 3;
const CARD_HEIGHT = CARD_WIDTH * 1.5;

const ProfileShowcaseSection = ({ 
  showcaseCards, 
  isCurrentUser, 
  onCardSlotPress,
  allUserCards,
  isLoadingCards,
  cardFetchError,
  onRetryLoadCards,
  onSelectCard
}) => {
  const theme = useTheme();
  const [isCardSelectionVisible, setIsCardSelectionVisible] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const handleCardSlotPress = (index) => {
    if (isCurrentUser) {
      setSelectedSlot(index);
      setIsCardSelectionVisible(true);
      onCardSlotPress(index);
    }
  };

  const handleSelectCard = (card) => {
    onSelectCard(card, selectedSlot);
    setIsCardSelectionVisible(false);
  };

  const renderCardSlot = (index) => {
    const card = showcaseCards[index];
    const isEmpty = !card;

    console.log(`Rendering showcase slot ${index}:`, { 
      isEmpty, 
      cardId: card?.id, 
      cardName: card?.name, 
      imageUrl: card?.imageUrl 
    });

    return (
      <TouchableOpacity
        key={index}
        style={[
          styles.cardSlot,
          isEmpty && styles.emptyCardSlot,
          !isCurrentUser && styles.disabledCardSlot
        ]}
        onPress={() => handleCardSlotPress(index)}
        disabled={!isCurrentUser}
        activeOpacity={0.7}
      >
        {isEmpty ? (
          <Text style={[styles.addCardText, { color: theme.colors.onSurfaceVariant }]}>
            {isCurrentUser ? 'Tap to add' : 'Empty'}
          </Text>
        ) : (
          <SimpleCardImage
            imageUrl={card.imageUrl}
            style={{
              width: CARD_WIDTH - 4, // Account for border
              height: CARD_HEIGHT - 4, // Account for border
              borderRadius: 8,
            }}
            rarityColor="#666"
            retryEnabled={true}
            placeholder="Showcase Card"
            key={`showcase-${card.id}-${index}`}
          />
        )}
      </TouchableOpacity>
    );
  };

  const renderCardSelectionModal = () => (
    <Portal>
      <Modal
        visible={isCardSelectionVisible}
        onDismiss={() => setIsCardSelectionVisible(false)}
        contentContainerStyle={styles.modalContainer}
      >
        <View style={[styles.modalContent, { backgroundColor: `${theme.colors.surface}E6` }]}>
          <Text style={[styles.modalTitle, { color: theme.colors.onSurface }]}>
            Select a Card
          </Text>
          <Text style={[styles.modalSubtitle, { color: theme.colors.onSurfaceVariant }]}>
            Choose a card for your showcase (slot {(selectedSlot || 0) + 1})
          </Text>
          
          {isLoadingCards ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={[styles.loadingText, { color: theme.colors.onSurface }]}>
                Loading your cards...
              </Text>
            </View>
          ) : cardFetchError ? (
            <View style={styles.errorContainer}>
              <Text style={[styles.errorText, { color: theme.colors.error }]}>
                {cardFetchError}
              </Text>
              <Button 
                mode="contained" 
                onPress={onRetryLoadCards}
                style={styles.retryButton}
              >
                Retry
              </Button>
            </View>
          ) : (
            <FlatList
              data={allUserCards}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  onPress={() => handleSelectCard(item)}
                  style={styles.cardSelectionItem}
                >
                  <View style={styles.cardListItem}>
                    <SimpleCardImage
                      imageUrl={item.imageUrl}
                      style={styles.cardListImage}
                      rarityColor="#666"
                      retryEnabled={true}
                      placeholder="Card Image"
                    />
                    <View style={styles.cardListDetails}>
                      <Text style={[styles.cardListName, { color: theme.colors.onSurface }]}>
                        {item.name}
                      </Text>
                      <Text style={[styles.cardListRarity, { color: theme.colors.onSurfaceVariant }]}>
                        {item.rarity}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              )}
              numColumns={1}
              contentContainerStyle={styles.cardsList}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={true}
              maxToRenderPerBatch={10}
              windowSize={10}
              initialNumToRender={10}
            />
          )}
          
          <Button 
            mode="outlined" 
            onPress={() => setIsCardSelectionVisible(false)}
            style={styles.closeButton}
          >
            Cancel
          </Button>
        </View>
      </Modal>
    </Portal>
  );

  return (
    <View>
      <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
        Showcase Cards
      </Text>
      <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>
        {isCurrentUser ? 'Tap on a card to change it' : 'Member\'s showcase'}
      </Text>
      
      <View style={styles.showcaseContainer}>
        {[0, 1, 2].map((_, index) => renderCardSlot(index))}
      </View>

      {renderCardSelectionModal()}
    </View>
  );
};

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 5,
    textAlign: 'center',
  },
  sectionSubtitle: {
    fontSize: 14,
    marginBottom: 15,
    textAlign: 'center',
    opacity: 0.8,
  },
  showcaseContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    marginTop: 20,
    marginBottom: 30,
    paddingHorizontal: CARD_MARGIN,
  },
  cardSlot: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    borderWidth: 2,
    marginHorizontal: CARD_MARGIN / 2,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    borderColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
  },
  emptyCardSlot: {
    borderStyle: 'dashed',
  },
  disabledCardSlot: {
    opacity: 0.5,
  },
  addCardText: {
    fontSize: 14,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.9)', // More translucent background
    padding: 20,
  },
  modalContent: {
    borderRadius: 16,
    padding: 24,
    width: '95%',
    maxHeight: '90%', // Taller modal
    minHeight: '75%', // Taller minimum height
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
    opacity: 0.8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    textAlign: 'center',
    marginBottom: 20,
    fontSize: 16,
  },
  retryButton: {
    marginTop: 12,
  },
  cardsList: {
    flexGrow: 1,
    paddingBottom: 16,
  },
  cardSelectionItem: {
    width: '100%',
    marginBottom: 12,
  },
  cardListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  cardListImage: {
    width: 80,
    height: 120,
    borderRadius: 8,
  },
  cardListDetails: {
    flex: 1,
    paddingLeft: 16,
  },
  cardListName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  cardListRarity: {
    fontSize: 14,
    textTransform: 'capitalize',
  },
  closeButton: {
    marginTop: 20,
    alignSelf: 'center',
    paddingHorizontal: 32,
  },
});

export default ProfileShowcaseSection; 