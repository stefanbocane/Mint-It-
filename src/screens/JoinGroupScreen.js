import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Appbar, Button, Card, HelperText, Text, TextInput, useTheme } from 'react-native-paper';
import ScreenBackground from '../components/ScreenBackground';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';

const JoinGroupScreen = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { refreshGroups, switchGroup } = useGroup();
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    setLoading(true);
    setError('');
    try {
      console.log('🔍 Fetching public groups from Supabase...');

      const { data: groupsData, error: fetchError } = await supabase
        .from('groups')
        .select('*')
        .eq('is_private', false)
        .order('created_at', { ascending: false });

      if (fetchError) {
        console.error('❌ Error fetching groups:', fetchError);
        throw fetchError;
      }

      console.log(`✅ Found ${groupsData?.length || 0} public groups`);

      const formattedGroups = (groupsData || []).map(g => ({
        id: g.id,
        name: g.name,
        description: g.description,
        isPrivate: g.is_private,
        memberCount: g.member_count || 0
      }));

      setGroups(formattedGroups);

      if (formattedGroups.length === 0) {
        console.log('⚠️ No public groups found. User may need to create one.');
      }
    } catch (error) {
      console.error('❌ Error in fetchGroups:', error);
      setError(`Failed to load groups: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGroup = async (groupName = null) => {
    console.log('🔵 Starting handleJoinGroup...');

    if (!user || !user.id) {
      console.error('❌ No user logged in');
      setError('You must be logged in to join a group.');
      return;
    }

    const nameToJoin = groupName || code.trim();
    if (!nameToJoin) {
      console.error('❌ No group name provided');
      setError('Group name is required');
      return;
    }

    console.log(`🔍 Attempting to join group: "${nameToJoin}"`);
    console.log(`👤 User ID: ${user.id}`);

    try {
      setLoading(true);
      setError('');

      // Find the group by name (case-insensitive)
      console.log('📡 Step 1: Searching for group...');
      const { data: groupsData, error: searchError } = await supabase
        .from('groups')
        .select('*')
        .ilike('name', nameToJoin)
        .limit(1);

      if (searchError) {
        console.error('❌ Error searching for group:', searchError);
        setError(`Database error: ${searchError.message}`);
        return;
      }

      console.log(`📦 Search result:`, groupsData);

      if (!groupsData || groupsData.length === 0) {
        console.error(`❌ Group "${nameToJoin}" not found in database`);
        setError(`Group "${nameToJoin}" not found. Please check the name and try again.`);
        return;
      }

      const group = groupsData[0];
      console.log(`✅ Found group:`, { id: group.id, name: group.name, members: group.members?.length });

      // Check if user is already a member
      const currentMembers = group.members || [];
      if (currentMembers.includes(user.id)) {
        console.warn('⚠️ User is already a member');
        setError('You are already a member of this group');
        return;
      }

      // Check group membership limit (max 5 groups)
      console.log('📡 Step 2: Checking user group count...');
      const { data: userGroups, error: countError } = await supabase
        .from('groups')
        .select('id')
        .contains('members', [user.id]);

      if (countError) {
        console.error('⚠️ Error checking group count:', countError);
        // Continue anyway
      }

      const currentGroupCount = userGroups?.length || 0;
      console.log(`📊 User is in ${currentGroupCount} groups`);

      if (currentGroupCount >= 5) {
        console.error('❌ User has reached group limit');
        setError(`You have reached the maximum of 5 groups. You are currently in ${currentGroupCount} groups.`);
        return;
      }

      // Add user to group members array
      const updatedMembers = [...currentMembers, user.id];
      console.log(`📡 Step 3: Adding user to group (${currentMembers.length} → ${updatedMembers.length} members)...`);

      // Update group with new member
      const { error: updateError } = await supabase
        .from('groups')
        .update({
          members: updatedMembers,
          member_count: updatedMembers.length
        })
        .eq('id', group.id);

      if (updateError) {
        console.error('❌ Error updating group:', updateError);
        setError(`Failed to join group: ${updateError.message}`);
        return;
      }

      console.log('✅ Successfully added to group members');

      // Award initial coins (100 coins for joining)
      console.log('📡 Step 4: Awarding initial coins...');
      try {
        const { error: balanceError } = await supabase.rpc('update_user_balance', {
          p_user_id: user.id,
          p_group_id: group.id,
          p_amount: 100,
          p_context: 'initial_group_join'
        });

        if (balanceError) {
          console.warn('⚠️ Error awarding initial coins:', balanceError.message);
          // Don't fail the join if coin award fails
        } else {
          console.log('✅ Awarded 100 coins');
        }
      } catch (coinError) {
        console.warn('⚠️ Coin award failed (non-critical):', coinError.message);
      }

      console.log('🔄 Step 5: Refreshing groups list...');

      // Refresh the groups list and switch to the new group
      await refreshGroups();

      const formattedGroup = {
        id: group.id,
        name: group.name,
        description: group.description,
        isPrivate: group.is_private,
        memberCount: updatedMembers.length
      };

      console.log('🔄 Step 6: Switching to new group...');
      switchGroup(formattedGroup);

      console.log('✅ Successfully joined group:', group.name);
      console.log('🔙 Navigating back...');

      navigation.goBack();
    } catch (error) {
      console.error('❌ Unexpected error in handleJoinGroup:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      setError(`Failed to join group: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredGroups = groups.filter(group =>
    group.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderGroup = ({ item }) => (
    <Card style={styles.groupCard}>
      <Card.Content>
        <Text variant="titleMedium">{item.name}</Text>
        <Text variant="bodyMedium" style={styles.description}>
          {item.description}
        </Text>
        <Text variant="bodySmall" style={styles.memberCount}>
          {item.memberCount || 0} members
        </Text>
      </Card.Content>
      <Card.Actions>
        <Button
          mode="contained"
          onPress={() => {
            setCode(item.name);
            handleJoinGroup();
          }}
        >
          Join Group
        </Button>
      </Card.Actions>
    </Card>
  );

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <Appbar.Header style={styles.header}>
          <Appbar.BackAction 
            onPress={() => navigation.goBack()} 
            iconColor={theme.colors.primary}
          />
          <Appbar.Content 
            title="Join Group" 
            titleStyle={{ color: theme.colors.text }}
          />
        </Appbar.Header>

        <View style={styles.content}>
          <TextInput
            label="Group Name"
            value={code}
            onChangeText={setCode}
            style={styles.input}
            error={!!error}
            placeholder="Enter the exact group name to join"
          />

          {error ? (
            <HelperText type="error" visible={!!error}>
              {error}
            </HelperText>
          ) : null}

          <Button
            mode="contained"
            onPress={handleJoinGroup}
            loading={loading}
            disabled={loading || !code.trim()}
            style={styles.button}
          >
            Join Group
          </Button>

          <Text variant="titleMedium" style={styles.sectionTitle}>
            Available Groups
          </Text>

          <TextInput
            placeholder="Search groups..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchInput}
          />

          {filteredGroups.map(group => (
            <Card key={group.id} style={styles.groupCard}>
              <Card.Content>
                <Text variant="titleMedium">{group.name}</Text>
                <Text variant="bodyMedium" style={styles.description}>
                  {group.description}
                </Text>
                <Text variant="bodySmall" style={styles.memberCount}>
                  {group.memberCount || 0} members
                </Text>
              </Card.Content>
              <Card.Actions>
                <Button
                  mode="contained"
                  onPress={() => handleJoinGroup(group.name)}
                  disabled={loading}
                >
                  Join Group
                </Button>
              </Card.Actions>
            </Card>
          ))}

          {loading && (
            <Text style={styles.loadingText}>Loading groups...</Text>
          )}

          {!loading && filteredGroups.length === 0 && (
            <Text style={styles.emptyText}>No groups found</Text>
          )}
        </View>
      </View>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: 16,
  },
  input: {
    marginBottom: 16,
  },
  button: {
    marginTop: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    marginBottom: 16,
    fontWeight: 'bold',
  },
  searchInput: {
    marginBottom: 16,
  },
  groupCard: {
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  description: {
    marginTop: 4,
    marginBottom: 8,
  },
  memberCount: {
    opacity: 0.7,
  },
  loadingText: {
    textAlign: 'center',
    marginTop: 20,
    opacity: 0.7,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 20,
    opacity: 0.7,
  },
  header: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    elevation: 2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
});

export default JoinGroupScreen; 