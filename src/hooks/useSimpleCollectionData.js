/**
 * ULTRA-SIMPLE Collection Data Hook - Supabase Version
 *
 * Goal: Fetch cards in 1 query, update state immediately, NO complex caching
 *
 * Strategy:
 * - Fetch from Supabase cards table (1 query for all user's cards)
 * - Update state IMMEDIATELY (no async cache operations to block)
 * - Keep simple in-memory persistent cache for remounts
 *
 * Expected performance:
 * - Fresh boot: 1 query, cards display in <1 second
 * - Remount: 0 queries (persistent cache)
 * - Refresh: 1 query
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';
import CardService from '../services/CardServiceSupabase';
import { supabase } from '../config/supabase';

// ONLY persistent cache (simple in-memory object, survives unmount/remount)
const persistentCardCache = {
  cards: [],
  userId: null,
  groupId: null,
  timestamp: 0
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Validate if ID is a valid UUID (Supabase format)
 * Firebase IDs are 20 alphanumeric chars, UUIDs are 36 with hyphens
 */
const isValidUUID = (id) => {
  if (!id || typeof id !== 'string') return false;
  // UUID pattern: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidPattern.test(id);
};

// Export cache clearing function
export const clearCollectionCache = () => {
  console.log('🧹 Clearing collection cache');
  persistentCardCache.cards = [];
  persistentCardCache.userId = null;
  persistentCardCache.groupId = null;
  persistentCardCache.timestamp = 0;
};

export const useSimpleCollectionData = () => {
  const [state, setState] = useState({
    cards: [],
    loading: true,
    refreshing: false,
    error: null
  });

  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const mountedRef = useRef(true);
  const initializingRef = useRef(false);

  // Fetch cards from Supabase (1 query)
  const fetchCards = useCallback(async (forceRefresh = false) => {
    console.log(`🔄 SIMPLE: fetchCards called (forceRefresh: ${forceRefresh})`);

    if (!user?.id || !currentGroup?.id) {
      console.log('⚠️ SIMPLE: No user or group, clearing cards');
      setState({ cards: [], loading: false, refreshing: false, error: null });
      return;
    }

    console.log(`   User: ${user.id}`);
    console.log(`   Group: ${currentGroup.id}`);

    // Validate that IDs are UUIDs (not Firebase IDs)
    if (!isValidUUID(user.id)) {
      console.error('❌ SIMPLE: Invalid user ID format (not a UUID):', user.id);
      setState({
        cards: [],
        loading: false,
        refreshing: false,
        error: 'Invalid user ID format. Please log out and log back in.'
      });
      return;
    }

    if (!isValidUUID(currentGroup.id)) {
      console.error('❌ SIMPLE: Invalid group ID format (not a UUID):', currentGroup.id);
      console.warn('⚠️ This appears to be a Firebase group ID. Please join or create a new group.');
      setState({
        cards: [],
        loading: false,
        refreshing: false,
        error: 'You need to join or create a group. The current group is from an old version.'
      });
      return;
    }

    // Check cache first (unless forcing refresh)
    const cacheAge = Date.now() - persistentCardCache.timestamp;
    const cacheValid = cacheAge < CACHE_TTL;
    const cacheMatches = persistentCardCache.userId === user.id && persistentCardCache.groupId === currentGroup.id;

    console.log(`📊 SIMPLE: Cache status:`, {
      forceRefresh,
      cacheMatches,
      cacheValid,
      cacheAge: Math.round(cacheAge / 1000) + 's',
      cachedCount: persistentCardCache.cards.length
    });

    if (!forceRefresh && cacheMatches && cacheValid) {
      console.log(`📦 SIMPLE: Using cached cards (${persistentCardCache.cards.length} cards)`);
      setState({
        cards: persistentCardCache.cards,
        loading: false,
        refreshing: false,
        error: null
      });
      return;
    }

    if (forceRefresh) {
      console.log('🔄 SIMPLE: Force refresh - bypassing cache');
    } else if (!cacheValid) {
      console.log('⏰ SIMPLE: Cache expired - fetching fresh data');
    } else if (!cacheMatches) {
      console.log('🔄 SIMPLE: User/group changed - fetching fresh data');
    }

    if (initializingRef.current) {
      console.log('⏸️ Fetch already in progress, skipping');
      return;
    }

    initializingRef.current = true;

    try {
      console.log('🚀 SIMPLE: Fetching cards from Supabase...');
      console.log(`🔍 SIMPLE: User: ${user.id}, Group: ${currentGroup.id}`);

      const cards = await CardService.getUserCards(user.id, currentGroup.id);

      console.log(`📦 SIMPLE: Found ${cards.length} cards`);

      if (cards.length > 0) {
        console.log(`📋 SIMPLE: Card names: ${cards.map(c => c.name).join(', ')}`);
        console.log(`🎨 SIMPLE: Card rarities:`, cards.map(c => `${c.name}=${c.rarity}`).join(', '));
      }

      // Transform cards with minimal processing
      const transformedCards = cards.map(card => ({
        ...card,
        // Ensure all required fields exist
        id: card.id,
        name: card.name || 'Unknown',
        rarity: card.rarity || 'common',
        status: card.status || 'available',
        imageUrl: card.imageUrl || card.image_url,
        ownerId: card.ownerId || user.id,
        groupId: card.groupId || currentGroup.id,
        inAuction: card.inAuction || false,
        inTrade: card.inTrade || false,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,

        // Display fields for compatibility
        ownerName: 'You',
        isOwned: true
      }));

      console.log(`✅ SIMPLE: Transformed ${transformedCards.length} cards`);

      // Update persistent cache
      persistentCardCache.cards = transformedCards;
      persistentCardCache.userId = user.id;
      persistentCardCache.groupId = currentGroup.id;
      persistentCardCache.timestamp = Date.now();

      // Update state
      if (mountedRef.current) {
        setState({
          cards: transformedCards,
          loading: false,
          refreshing: false,
          error: null
        });
      }

    } catch (error) {
      console.error('❌ SIMPLE: Error fetching cards:', error);
      if (mountedRef.current) {
        setState({
          cards: [],
          loading: false,
          refreshing: false,
          error: error.message || 'Failed to load cards'
        });
      }
    } finally {
      initializingRef.current = false;
    }
  }, [user?.id, currentGroup?.id]);

  // Initialize on mount
  useEffect(() => {
    mountedRef.current = true;
    fetchCards();

    return () => {
      mountedRef.current = false;
    };
  }, [fetchCards]);

  // Refresh (force refresh bypasses cache)
  const refresh = useCallback(async () => {
    setState(prev => ({ ...prev, refreshing: true }));

    // First, complete any expired auctions
    try {
      console.log('🔄 Completing expired auctions before refresh...');
      const { data: completedAuctions, error } = await supabase.rpc('complete_auctions');

      if (error) {
        console.warn('⚠️ Error completing auctions:', error.message);
      } else if (completedAuctions && completedAuctions.length > 0) {
        console.log(`✅ Completed ${completedAuctions.length} expired auction(s) before refresh`);
      }
    } catch (error) {
      console.warn('⚠️ Failed to complete auctions:', error);
    }

    // Then fetch cards
    await fetchCards(true); // Force refresh
  }, [fetchCards]);

  // Add a card to the local state
  const addCard = useCallback((newCard) => {
    setState(prev => ({
      ...prev,
      cards: [newCard, ...prev.cards]
    }));
    // Update cache
    persistentCardCache.cards = [newCard, ...persistentCardCache.cards];
  }, []);

  // Remove a card from local state
  const removeCard = useCallback((cardId) => {
    setState(prev => ({
      ...prev,
      cards: prev.cards.filter(c => c.id !== cardId)
    }));
    // Update cache
    persistentCardCache.cards = persistentCardCache.cards.filter(c => c.id !== cardId);
  }, []);

  // Update a card in local state
  const updateCard = useCallback((cardId, updates) => {
    setState(prev => ({
      ...prev,
      cards: prev.cards.map(c =>
        c.id === cardId ? { ...c, ...updates } : c
      )
    }));
    // Update cache
    persistentCardCache.cards = persistentCardCache.cards.map(c =>
      c.id === cardId ? { ...c, ...updates } : c
    );
  }, []);

  return {
    cards: state.cards,
    loading: state.loading,
    refreshing: state.refreshing,
    error: state.error,
    refresh,
    onRefresh: refresh,  // ← Add alias for compatibility with CollectionScreen
    addCard,
    removeCard,
    updateCard
  };
};
