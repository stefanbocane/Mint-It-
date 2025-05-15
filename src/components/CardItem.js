/**
 * Shared CardItem component
 * 
 * A flexible card component that can be used in different contexts:
 * - Simple display (auction screen style)
 * - Detailed display with image (trade screen style)
 * - With various selection mechanisms
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Card } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// Default color map for rarity levels
const DEFAULT_RARITY_COLORS = {
  common: '#AAAAAA',
  uncommon: '#00AA00',
  rare: '#0000AA',
  epic: '#AA00AA',
  legendary: '#FFAA00',
  mythic: '#FF0000'
};

const CardItem = ({
  item,
  isSelected = false,
  onPress,
  selectionMode = 'simple',  // 'simple', 'detailed', 'requestable'
  displayMode = 'minimal',   // 'minimal', 'standard', 'detailed'
  selectionText = 'Selected',
  rarityColors = DEFAULT_RARITY_COLORS,
  containerStyle = {},
  selectedStyle = {},
  textStyle = {}
}) => {
  // Handle simple/minimal display mode (used in auction screen)
  if (displayMode === 'minimal') {
    return (
      <TouchableOpacity 
        style={[
          styles.minimalContainer,
          isSelected && styles.selectedMinimal,
          containerStyle
        ]}
        onPress={() => onPress && onPress(item)}
      >
        <View style={styles.minimalContent}>
          <Text style={[styles.minimalName, textStyle]} numberOfLines={1}>
            {item.name}
          </Text>
          {isSelected && (
            <View style={styles.selectedIndicator}>
              <MaterialCommunityIcons name="check-circle" size={20} color="#4CAF50" />
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  // Handle standard/detailed display (used in trade screens)
  return (
    <TouchableOpacity onPress={() => onPress && onPress(item)}>
      <Card
        style={[
          styles.cardContainer,
          isSelected && { borderColor: rarityColors[item.rarity] || '#4CAF50', borderWidth: 2 },
          containerStyle
        ]}
      >
        {/* Only show the image in standard or detailed mode */}
        {(displayMode === 'standard' || displayMode === 'detailed') && 
          item.imageUrl && <Card.Cover source={{ uri: item.imageUrl }} style={styles.cardImage} />
        }
        
        <Card.Content>
          <Text style={[styles.cardName, textStyle]} numberOfLines={1}>
            {item.name}
          </Text>
          
          {/* Show rarity in standard or detailed mode */}
          {(displayMode === 'standard' || displayMode === 'detailed') && item.rarity && (
            <Text 
              style={[
                styles.cardRarity, 
                { color: rarityColors[item.rarity] || DEFAULT_RARITY_COLORS.common }
              ]}
            >
              {item.rarity}
            </Text>
          )}
          
          {/* Show selection overlay */}
          {isSelected && (
            <View style={styles.selectedOverlay}>
              <Text style={styles.selectedText}>{selectionText}</Text>
            </View>
          )}
          
          {/* Show additional details in detailed mode */}
          {displayMode === 'detailed' && item.description && (
            <Text style={styles.cardDescription} numberOfLines={2}>
              {item.description}
            </Text>
          )}
        </Card.Content>
      </Card>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  // Minimal mode styles (auction screen style)
  minimalContainer: {
    padding: 8,
    marginVertical: 4,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  selectedMinimal: {
    borderColor: '#4CAF50',
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
  },
  minimalContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  minimalName: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  selectedIndicator: {
    marginLeft: 8,
  },
  
  // Standard card styles (trade screen style)
  cardContainer: {
    margin: 6,
    elevation: 2,
    borderRadius: 8,
  },
  cardImage: {
    height: 120,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  cardName: {
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 4,
  },
  cardRarity: {
    fontSize: 12,
    marginTop: 2,
  },
  cardDescription: {
    fontSize: 12,
    marginTop: 4,
    color: '#666',
  },
  selectedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 4,
  },
  selectedText: {
    color: 'white',
    fontWeight: 'bold',
  },
});

export default CardItem;
