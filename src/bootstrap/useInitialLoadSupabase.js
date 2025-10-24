/**
 * Initial Load Hook - Supabase Version
 *
 * Uses Postgres function `get_bootstrap_payload()` for single-query bootstrap.
 * Replaces Firebase `initialAppLoad/{userId}_{groupId}` document.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../services/ReadTracking/SupabaseTracked';

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
        // Call Postgres function for complete bootstrap payload
        const { data, error: rpcError } = await supabase.rpc('get_bootstrap_payload', {
          p_user_id: uid,
          p_group_id: groupId
        });

        if (!isMounted) return;

        if (rpcError) {
          console.error('Bootstrap error:', rpcError);
          setError(rpcError);
          setPayload({});
        } else {
          setPayload(data || {});
        }
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
