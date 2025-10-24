import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../config/firebase';
import { useAuth } from './AuthContext';
import { useGroup } from './GroupContext';

const GroupSessionContext = createContext({ sessionData: null, loading: true });

export const GroupSessionProvider = ({ children }) => {
  const { user } = useAuth();
  const { currentGroup } = useGroup();
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid || !currentGroup?.id) {
      setSessionData(null);
      setLoading(false);
      return;
    }

    // Listen to lightweight per-user group session doc
    const ref = doc(db, 'groups', currentGroup.id, 'sessions', user.uid);
    setLoading(true);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        setSessionData(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setLoading(false);
      },
      (err) => {
        console.error('GroupSessionContext listener error', err);
        setSessionData(null);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [user?.uid, currentGroup?.id]);

  return (
    <GroupSessionContext.Provider value={{ sessionData, loading }}>
      {children}
    </GroupSessionContext.Provider>
  );
};

export const useGroupSession = () => useContext(GroupSessionContext); 