import { collection, deleteDoc, doc, query, where } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { db } from '../config/firebase';
import { getDoc, getDocs } from '../services/ReadTracking/TrackedFirestore';

/**
 * Deletes groups that have zero members
 * Can be called periodically or after a user leaves a group
 * @returns {Promise<{success: boolean, deleted: number, groups: string[]}>} Result object
 */
export const deleteEmptyGroups = async () => {
  try {
    console.log('CLEANUP: Checking for empty groups to delete');
    
    // Find groups with empty members array or memberCount = 0
    const groupsRef = collection(db, 'groups');
    const emptyGroupsQuery = query(
      groupsRef, 
      where('memberCount', '==', 0)
    );
    
    const emptyGroupsSnapshot = await getDocs(emptyGroupsQuery);
    
    if (emptyGroupsSnapshot.empty) {
      console.log('CLEANUP: No empty groups found');
      return { success: true, deleted: 0, groups: [] };
    }
    
    console.log(`CLEANUP: Found ${emptyGroupsSnapshot.size} empty groups to delete`);
    
    const deletedGroups = [];
    
    // Delete each empty group
    for (const groupDoc of emptyGroupsSnapshot.docs) {
      const groupId = groupDoc.id;
      const groupName = groupDoc.data().name;
      
      console.log(`CLEANUP: Deleting empty group: ${groupName} (${groupId})`);
      
      // Delete the group document
      await deleteDoc(doc(db, 'groups', groupId));
      
      deletedGroups.push({
        id: groupId,
        name: groupName
      });
    }
    
    console.log(`CLEANUP: Successfully deleted ${deletedGroups.length} empty groups`);
    
    return {
      success: true,
      deleted: deletedGroups.length,
      groups: deletedGroups
    };
  } catch (error) {
    console.error('CLEANUP: Error deleting empty groups:', error);
    return {
      success: false,
      deleted: 0,
      groups: [],
      error: error.message
    };
  }
};

/**
 * Checks if a group is empty and deletes it if it is
 * Should be called when a user leaves a group
 * @param {string} groupId - The ID of the group to check
 * @returns {Promise<boolean>} - Success status
 */
export const deleteGroupIfEmpty = async (groupId) => {
  if (!groupId) return false;
  
  try {
    console.log(`CLEANUP: Checking if group ${groupId} is empty`);
    
    // Get the group document
    const groupRef = doc(db, 'groups', groupId);
    const groupSnapshot = await getDoc(groupRef);
    
    // If group doesn't exist, return true (it's already gone)
    if (!groupSnapshot.exists()) {
      console.log(`CLEANUP: Group ${groupId} doesn't exist`);
      return true;
    }
    
    const groupData = groupSnapshot.data();
    
    // Check if the group is empty
    if (!groupData.members || groupData.members.length === 0 || groupData.memberCount === 0) {
      console.log(`CLEANUP: Group ${groupId} is empty, deleting it`);
      
      // Delete the group document
      await deleteDoc(groupRef);
      
      console.log(`CLEANUP: Successfully deleted empty group ${groupId}`);
      return true;
    }
    
    console.log(`CLEANUP: Group ${groupId} is not empty (${groupData.memberCount} members)`);
    return false;
  } catch (error) {
    console.error(`CLEANUP: Error checking if group ${groupId} is empty:`, error);
    return false;
  }
}; 