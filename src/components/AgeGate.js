import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import { useTheme } from '../contexts/ThemeContext';

const AgeGate = ({ onAgeVerified, onAgeRejected }) => {
  const [birthYear, setBirthYear] = useState('');
  const [error, setError] = useState('');
  const { theme } = useTheme();

  const handleVerifyAge = () => {
    const year = parseInt(birthYear);
    const currentYear = new Date().getFullYear();
    
    if (!year || isNaN(year)) {
      setError('Please enter a valid birth year');
      return;
    }
    
    if (year < 1900 || year > currentYear) {
      setError('Please enter a valid birth year');
      return;
    }
    
    const age = currentYear - year;
    
    if (age < 13) {
      onAgeRejected();
    } else {
      onAgeVerified();
    }
  };

  return (
    <View style={styles.container}>
      <Card style={styles.card}>
        <Card.Content>
          <Text style={[styles.title, { color: theme.colors.text }]}>
            Age Verification Required
          </Text>
          
          <Text style={[styles.description, { color: theme.colors.text }]}>
            You must be at least 13 years old to use Mint. Please enter your birth year to continue.
          </Text>
          
          <TextInput
            label="Birth Year (e.g., 2000)"
            value={birthYear}
            onChangeText={(text) => {
              setBirthYear(text);
              setError('');
            }}
            keyboardType="numeric"
            maxLength={4}
            style={styles.input}
            mode="outlined"
            error={!!error}
          />
          
          {error && (
            <Text style={[styles.errorText, { color: theme.colors.error }]}>
              {error}
            </Text>
          )}
          
          <Button
            mode="contained"
            onPress={handleVerifyAge}
            style={styles.button}
            disabled={!birthYear.trim()}
          >
            Verify Age
          </Button>
          
          <Text style={[styles.disclaimer, { color: theme.colors.textSecondary }]}>
            We collect this information only to verify your age and comply with privacy laws.
          </Text>
        </Card.Content>
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  input: {
    marginBottom: 16,
  },
  errorText: {
    textAlign: 'center',
    marginBottom: 16,
  },
  button: {
    marginBottom: 16,
  },
  disclaimer: {
    fontSize: 12,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});

export default AgeGate; 