import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, ActivityIndicator, Card, Title, Subheading } from 'react-native-paper';
import { useStats } from '../contexts/StatsContext';

const RARITY_NAMES = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythic: 'Mythic'
};

const UserStats = ({ userId }) => {
  const { stats, loading, error } = useStats();

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  if (error) {
    return <Text style={styles.error}>{error}</Text>;
  }

  if (!stats) {
    return <Text>No statistics available</Text>;
  }

  const renderRarityStats = (rarityData, title, countKey = 'completed') => {
    if (!rarityData) return null;

    return (
      <Card style={styles.card}>
        <Card.Content>
          <Subheading style={styles.sectionTitle}>{title}</Subheading>
          {Object.entries(rarityData).map(([rarity, data]) => (
            <View key={rarity} style={styles.statRow}>
              <Text style={styles.statLabel}>
                {RARITY_NAMES[rarity] || rarity}:
              </Text>
              <Text style={styles.statValue}>
                {typeof data === 'object' ? data[countKey] || 0 : data}
              </Text>
            </View>
          ))}
        </Card.Content>
      </Card>
    );
  };

  return (
    <ScrollView style={styles.container}>
      <Card style={[styles.card, styles.summaryCard]}>
        <Card.Content>
          <Title style={styles.title}>Trading Statistics</Title>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Trades Completed:</Text>
            <Text style={styles.statValue}>{stats.tradesCompleted || 0}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Auctions Won:</Text>
            <Text style={styles.statValue}>{stats.auctionsWon || 0}</Text>
          </View>
        </Card.Content>
      </Card>

      {stats.rarityTraded && Object.keys(stats.rarityTraded).length > 0 && (
        <Card style={styles.card}>
          <Card.Content>
            <Subheading style={styles.sectionTitle}>Cards Traded by Rarity</Subheading>
            {Object.entries(stats.rarityTraded).map(([rarity, count]) => (
              <View key={rarity} style={styles.statRow}>
                <Text style={styles.statLabel}>
                  {RARITY_NAMES[rarity] || rarity}:
                </Text>
                <Text style={styles.statValue}>{count}</Text>
              </View>
            ))}
          </Card.Content>
        </Card>
      )}

      {stats.auctionsByRarity && Object.keys(stats.auctionsByRarity).length > 0 && (
        <>
          {renderRarityStats(stats.auctionsByRarity, 'Auctions Won by Rarity', 'won')}
          {renderRarityStats(stats.auctionsByRarity, 'Auctions Completed by Rarity')}
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 10,
  },
  loader: {
    marginTop: 20,
  },
  error: {
    color: 'red',
    textAlign: 'center',
    marginTop: 20,
  },
  card: {
    marginBottom: 15,
    borderRadius: 8,
    elevation: 3,
  },
  summaryCard: {
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
    color: '#333',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingVertical: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
  },
  statValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000',
  },
});

export default UserStats;
