import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Appbar, Button, HelperText, Switch, Text, TextInput, useTheme } from 'react-native-paper';
import ScreenBackground from '../components/ScreenBackground';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useGroup } from '../contexts/GroupContextSupabase';
import CacheService from '../services/caching/CacheService';

const CreateGroupScreen = ({ navigation }) => {
  const { user } = useAuth();
  const { refreshGroups, switchGroup, addGroup } = useGroup();
  const theme = useTheme();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreateGroup = async () => {
    console.log('🔵 Create group called', { user: user?.id, name: name.trim() });

    // Supabase uses user.id instead of user.uid
    if (!user || !user.id) {
      console.log('❌ No user logged in');
      setError('You must be logged in to create a group.');
      return;
    }
    if (!name.trim()) {
      console.log('❌ Group name empty');
      setError('Group name is required');
      return;
    }

    try {
      setLoading(true);
      setError('');
      console.log('✅ Validation passed, creating group...');

      // Check group membership limit (count current groups)
      const { count: currentCount, error: countError } = await supabase
        .from('groups')
        .select('*', { count: 'exact', head: true })
        .contains('members', [user.id]);

      if (countError) throw countError;

      const MAX_GROUPS = 10;
      if (currentCount >= MAX_GROUPS) {
        setError(`You have reached the maximum of ${MAX_GROUPS} groups. You are currently in ${currentCount} groups.`);
        setLoading(false);
        return;
      }

      // Get user profile for username
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('username')
        .eq('id', user.id)
        .single();

      if (userError) throw userError;

      // Create the group in Supabase
      const { data: newGroup, error: groupError } = await supabase
        .from('groups')
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          is_private: isPrivate,
          created_by: user.id,
          members: [user.id],
          admin_ids: [user.id],
          code: name.trim().toLowerCase(),
          member_count: 1
        })
        .select()
        .single();

      if (groupError) throw groupError;

      // Award initial coins (100) using Supabase function
      const { data: balanceResult, error: balanceError } = await supabase.rpc('update_balance', {
        p_user_id: user.id,
        p_group_id: newGroup.id,
        p_amount: 100
      });

      if (balanceError) {
        console.error('Error awarding initial coins:', balanceError);
      } else {
        console.log('✅ Initial coins awarded:', balanceResult);
      }

      // Invalidate relevant caches
      await Promise.allSettled([
        CacheService.invalidate(`groups:${user.id}`),
        CacheService.invalidate(`all_groups_names`),
        CacheService.invalidate(`user_groups_${user.id}`),
        CacheService.invalidate(`users:${user.id}`),
        CacheService.invalidate(`groups/${newGroup.id}/members:${user.id}`),
        CacheService.invalidate(`groups:${newGroup.id}`)
      ]);

      // Format group for GroupContext
      const formattedGroup = {
        id: newGroup.id,
        name: newGroup.name,
        description: newGroup.description,
        isPrivate: newGroup.is_private,
        createdBy: newGroup.created_by,
        createdAt: newGroup.created_at,
        memberCount: newGroup.member_count,
        members: newGroup.members,
        code: newGroup.code
      };

      // Add to groups list and switch to it
      addGroup(formattedGroup);
      switchGroup(formattedGroup);

      console.log('✅ Group created and added to GroupContext');

      // Show success message
      Alert.alert('Success', 'Group created successfully!', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (error) {
      console.error('Error creating group:', error);
      setError(error.message || 'Failed to create group. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <Appbar.Header style={styles.header}>
          <Appbar.BackAction 
            onPress={() => navigation.goBack()} 
            iconColor={theme.colors.primary}
          />
          <Appbar.Content 
            title="Create Group" 
            titleStyle={{ color: theme.colors.text }}
          />
        </Appbar.Header>

        <View style={styles.content}>
          <TextInput
            label="Group Name"
            value={name}
            onChangeText={setName}
            style={styles.input}
            error={!!error && !name.trim()}
          />

          <TextInput
            label="Description"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            style={styles.input}
          />

          <View style={styles.switchContainer}>
            <Text>Private Group</Text>
            <Switch
              value={isPrivate}
              onValueChange={setIsPrivate}
            />
          </View>

          <HelperText type="info" visible={isPrivate}>
            Private groups require approval to join
          </HelperText>

          {error ? (
            <HelperText type="error" visible={!!error}>
              {error}
            </HelperText>
          ) : null}

          <Button
            mode="contained"
            onPress={handleCreateGroup}
            loading={loading}
            disabled={loading || !name.trim()}
            style={styles.button}
          >
            Create Group
          </Button>
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
    padding: 100,
  },
  input: {
    marginBottom: 16,
  },
  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  button: {
    marginTop: 16,
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

export default CreateGroupScreen; 