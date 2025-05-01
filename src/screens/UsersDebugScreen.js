import { collection, getDocs } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { db } from '../config/firebase';

export default function UsersDebugScreen() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    (async () => {
      const snapshot = await getDocs(collection(db, 'users'));
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log('🔍 Users in Firestore:', list);
      setUsers(list);
    })();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Firestore "users" Collection</Text>
      <FlatList
        data={users}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text style={styles.email}>{item.email}</Text>
            <Text style={styles.coins}>Coins: {item.coinBalance}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  item: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#ccc' },
  email: { fontSize: 16 },
  coins: { fontSize: 14, color: '#666' },
}); 