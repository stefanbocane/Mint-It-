import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useInitialLoad } from '../bootstrap/useInitialLoad';
import useInitialStore from '../store/useInitialStore';

// Reuse existing loading screen to keep consistent UX
let LoadingScreen;
try {
  // Optional: if project has standardized LoadingScreen component
  // eslint-disable-next-line global-require, import/no-dynamic-require
  LoadingScreen = require('../components/LoadingScreen').default;
} catch {
  LoadingScreen = () => (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Loading...</Text>
    </View>
  );
}

const InitialLoadGate = ({ uid, groupId, children }) => {
  const { payload, loading } = useInitialLoad(uid, groupId);
  const setPayload = useInitialStore(state => state.setPayload);

  useEffect(() => {
    if (payload) {
      setPayload(payload);
    }
  }, [payload]);

  if (loading) {
    return <LoadingScreen />;
  }

  return children;
};

export default InitialLoadGate; 