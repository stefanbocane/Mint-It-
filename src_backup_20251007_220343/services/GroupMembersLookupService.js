import { collection, doc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from '../config/firebase';
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
        console.log(`[GroupMembersLookupService] Cache miss for group ${groupId}, fetching from Firestore`);
        
        // Check for existing denormalized data first
        const denormalizedData = await CacheService.getDocument('groupMembers', groupId, {
          ttl: this.CACHE_TTL.MEMBERS,
          fallback: null
        });
        
        if (denormalizedData && denormalizedData.members && 
            Date.now() - denormalizedData.lastUpdated < this.CACHE_TTL.MEMBERS) {
          console.log(`[GroupMembersLookupService] Using denormalized data for group ${groupId}`);
          return denormalizedData.memberData || denormalizedData.members;
        }
        
        // Fallback to array-contains query if no cached data
        console.log(`[GroupMembersLookupService] Performing array-contains query for group ${groupId}`);
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('groups', 'array-contains', groupId));
        const snapshot = await getDocs(q);
        
        const members = snapshot.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data(),
          lastFetched: Date.now()
        }));
        
        // Store denormalized data for future queries
        await this.storeDenormalizedMembers(groupId, members);
        
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
   */
  static async storeDenormalizedMembers(groupId, members) {
    try {
      const denormalizedData = {
        groupId,
        members: members.map(m => m.id),
        memberData: members,
        lastUpdated: Date.now(),
        memberCount: members.length
      };
      
      // Store in Firestore for persistence across app sessions
      await setDoc(doc(db, 'groupMembers', groupId), {
        ...denormalizedData,
        lastUpdated: serverTimestamp()
      });
      
      // Also cache in memory for immediate access
      await CacheService.setValue(`group_members_${groupId}`, members, {
        ttl: this.CACHE_TTL.MEMBERS
      });
      
      console.log(`[GroupMembersLookupService] Stored denormalized data for group ${groupId} with ${members.length} members`);
    } catch (error) {
      console.error(`[GroupMembersLookupService] Error storing denormalized data for group ${groupId}:`, error);
    }
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