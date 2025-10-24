import { supabase } from '../config/supabase';
import CacheService from './caching/CacheService';

/**
 * GroupMembersLookupService - Optimizes array-contains queries for group member lookups
 * 
 * This service replaces expensive array-contains queries with cached denormalized data.
 * Expected read reduction: 60-70% for group member operations.
 */
class GroupMembersLookupService {
  static CACHE_TTL = {
    MEMBERS: 10 * 60 * 1000,     // 10 minutes for member lists
    MEMBER_DATA: 5 * 60 * 1000,  // 5 minutes for detailed member data
    LEADERBOARD: 2 * 60 * 1000   // 2 minutes for leaderboard data
  };

  /**
   * Get all members of a group with caching optimization
   * @param {string} groupId - The group ID
   * @param {Object} options - Cache and query options
   * @returns {Promise<Array>} Array of member objects
   */
  static async getGroupMembers(groupId, options = {}) {
    const cacheKey = `group_members_${groupId}`;

    try {
      return await CacheService.getOrSet(cacheKey, async () => {
        console.log(`[GroupMembersLookupService] Cache miss for group ${groupId}, fetching from Supabase`);

        // Get group and its members array from Supabase
        const { data: groupData, error: groupError } = await supabase
          .from('groups')
          .select('members')
          .eq('id', groupId)
          .single();

        if (groupError) {
          console.error(`[GroupMembersLookupService] Error fetching group:`, groupError);
          throw groupError;
        }

        const memberIds = groupData?.members || [];

        if (memberIds.length === 0) {
          console.log(`[GroupMembersLookupService] No members in group ${groupId}`);
          return [];
        }

        // Fetch user profiles for all members
        const { data: users, error: usersError } = await supabase
          .from('users')
          .select('id, username, display_name, email, avatar_url, gems, xp, level')
          .in('id', memberIds);

        if (usersError) {
          console.error(`[GroupMembersLookupService] Error fetching users:`, usersError);
          throw usersError;
        }

        const members = (users || []).map(user => ({
          id: user.id,
          uid: user.id, // For backwards compatibility
          username: user.username,
          displayName: user.display_name || user.username,
          email: user.email,
          profilePicture: user.avatar_url,
          gems: user.gems,
          xp: user.xp,
          level: user.level,
          lastFetched: Date.now()
        }));

        console.log(`[GroupMembersLookupService] Fetched ${members.length} members for group ${groupId}`);

        return members;
      }, {
        ttl: this.CACHE_TTL.MEMBERS,
        ...options
      });
    } catch (error) {
      console.error(`[GroupMembersLookupService] Error fetching group members for ${groupId}:`, error);

      // Return cached data even if stale on error
      const staleData = await CacheService.getValue(cacheKey);
      if (staleData) {
        console.warn(`[GroupMembersLookupService] Returning stale data for group ${groupId}`);
        return staleData;
      }

      throw error;
    }
  }

  /**
   * Get member IDs only (lighter weight operation)
   * @param {string} groupId - The group ID
   * @param {Object} options - Cache options
   * @returns {Promise<Array>} Array of member IDs
   */
  static async getGroupMemberIds(groupId, options = {}) {
    const members = await this.getGroupMembers(groupId, options);
    return members.map(member => member.id);
  }

  /**
   * Get specific member data for users participating in trades
   * @param {string} groupId - The group ID
   * @param {string} userId - Specific user ID to check
   * @param {Object} options - Cache options
   * @returns {Promise<Object|null>} Member data or null if not found
   */
  static async getUserMembershipData(groupId, userId, options = {}) {
    const cacheKey = `user_membership_${userId}_${groupId}`;
    
    return await CacheService.getOrSet(cacheKey, async () => {
      const members = await this.getGroupMembers(groupId, options);
      return members.find(member => member.id === userId) || null;
    }, { 
      ttl: this.CACHE_TTL.MEMBER_DATA,
      ...options 
    });
  }

  /**
   * Get group members optimized for leaderboard computation
   * @param {string} groupId - The group ID
   * @param {Object} options - Cache options including forceRefresh
   * @returns {Promise<Array>} Array of members with leaderboard-relevant data
   */
  static async getGroupMembersForLeaderboard(groupId, options = {}) {
    const cacheKey = `group_members_leaderboard_${groupId}`;
    
    // Handle force refresh
    if (options.forceRefresh) {
      await CacheService.invalidate(cacheKey);
      console.log(`[GroupMembersLookupService] Force refreshing leaderboard data for group ${groupId}`);
    }
    
    return await CacheService.getOrSet(cacheKey, async () => {
      console.log(`[GroupMembersLookupService] Fetching fresh group members for leaderboard: ${groupId}`);
      const members = await this.getGroupMembers(groupId, options);
      
      // Return only leaderboard-relevant fields to reduce memory usage
      const leaderboardMembers = members.map(member => ({
        id: member.id,
        name: member.name,
        displayName: member.displayName, // Add displayName for better user identification
        username: member.username, // Add username as fallback
        profileImageUrl: member.profileImageUrl,
        coins: member.coins || 0,
        gems: member.gems || 0,
        lastActive: member.lastActive
      }));
      
      console.log(`[GroupMembersLookupService] Returning ${leaderboardMembers.length} members for leaderboard`);
      return leaderboardMembers;
    }, { 
      ttl: this.CACHE_TTL.LEADERBOARD,
      ...options 
    });
  }

  /**
   * Store denormalized member data for future optimization
   * @param {string} groupId - The group ID
   * @param {Array} members - Member data array
   * @deprecated No longer needed with Supabase - data is already normalized
   */
  static async storeDenormalizedMembers(groupId, members) {
    // No-op: Supabase stores members in normalized tables
    // Data is cached in CacheService automatically via getOrSet
    console.log(`[GroupMembersLookupService] storeDenormalizedMembers called (no-op for Supabase)`);
  }

  /**
   * Invalidate cached member data when group membership changes
   * @param {string} groupId - The group ID
   * @param {string} userId - User ID that changed (optional)
   */
  static async invalidateGroupMembers(groupId, userId = null) {
    try {
      // Clear main group members cache
      await CacheService.invalidate(`group_members_${groupId}`);
      await CacheService.invalidate(`group_members_leaderboard_${groupId}`);
      
      // Clear specific user membership cache if provided
      if (userId) {
        await CacheService.invalidate(`user_membership_${userId}_${groupId}`);
      }
      
      // Clear denormalized document cache
      await CacheService.invalidate(`groupMembers:${groupId}`);
      
      console.log(`[GroupMembersLookupService] Invalidated caches for group ${groupId}${userId ? `, user ${userId}` : ''}`);
    } catch (error) {
      console.error(`[GroupMembersLookupService] Error invalidating caches for group ${groupId}:`, error);
    }
  }

  /**
   * Warm up cache for frequently accessed groups
   * @param {Array} groupIds - Array of group IDs to warm up
   */
  static async warmUpGroupCaches(groupIds) {
    console.log(`[GroupMembersLookupService] Warming up caches for ${groupIds.length} groups`);
    
    const warmupPromises = groupIds.map(async (groupId) => {
      try {
        await this.getGroupMembers(groupId, { ttl: this.CACHE_TTL.MEMBERS });
        console.log(`[GroupMembersLookupService] Cache warmed for group ${groupId}`);
      } catch (error) {
        console.warn(`[GroupMembersLookupService] Failed to warm cache for group ${groupId}:`, error);
      }
    });
    
    await Promise.allSettled(warmupPromises);
  }

  /**
   * Get optimization metrics for monitoring
   * @returns {Object} Metrics object
   */
  static getMetrics() {
    return {
      serviceName: 'GroupMembersLookupService',
      optimizationTarget: 'Array-contains queries for group members',
      expectedReadReduction: '60-70%',
      cacheKeys: [
        'group_members_*',
        'group_members_leaderboard_*', 
        'user_membership_*',
        'groupMembers:*'
      ],
      activeOptimizations: [
        'Denormalized member storage',
        'Multi-level caching',
        'Leaderboard-optimized queries',
        'Selective field projection'
      ]
    };
  }
}

export default GroupMembersLookupService; 