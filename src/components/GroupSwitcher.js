import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Menu, useTheme } from 'react-native-paper';
import { useGroup } from '../contexts/GroupContextSupabase';

const GroupSwitcher = () => {
  const [visible, setVisible] = useState(false);
  const { groups, currentGroup, switchGroup } = useGroup();
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <Menu
        visible={visible}
        onDismiss={() => setVisible(false)}
        anchor={
          <Button
            mode="contained"
            onPress={() => setVisible(true)}
            style={styles.button}
            icon="account-group"
          >
            {currentGroup ? currentGroup.name : 'Select Group'}
          </Button>
        }
      >
        {groups.map(group => (
          <Menu.Item
            key={group.id}
            onPress={() => {
              switchGroup(group);
              setVisible(false);
            }}
            title={group.name}
            leadingIcon={currentGroup?.id === group.id ? 'check' : undefined}
          />
        ))}
      </Menu>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginRight: 16,
  },
  button: {
    backgroundColor: '#4CAF50',
  },
});

export default GroupSwitcher; 