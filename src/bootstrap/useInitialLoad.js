import { doc } from 'firebase/firestore';
// 🚀 TRACKED: Automatic read monitoring
import { useEffect, useState } from 'react';
import { db } from '../config/firebase';
import { getDoc } from '../services/ReadTracking/TrackedFirestore';

export const useInitialLoad = (uid, groupId) => {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!uid || !groupId) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    const fetchInitial = async () => {
      try {
        const ref = doc(db, 'initialAppLoad', `${uid}_${groupId}`);
        const snap = await getDoc(ref);
        if (!isMounted) return;
        setPayload(snap.exists() ? snap.data() : {});
      } catch (err) {
        if (isMounted) setError(err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchInitial();
    return () => {
      isMounted = false;
    };
  }, [uid, groupId]);

  return { payload, loading, error };
}; 