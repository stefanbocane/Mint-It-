import { StyleSheet, View } from 'react-native';
import { useBalance } from '../hooks/useBackwardCompatibility';
import CoinCount from './CoinCount';

const CoinHeader = () => {
  // Get the balance from context but DO NOT trigger refreshes
  const { balance } = useBalance();
  
  // No need to call refreshBalance() here as that can cause unwanted
  // 200 coin awards in some situations
  
  return (
    <View style={styles.container}>
      <CoinCount size="normal" showLabel={false} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

export default CoinHeader; 