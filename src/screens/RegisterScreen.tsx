import React, { useState } from 'react';
import { Alert, Image, Keyboard, StyleSheet, TouchableWithoutFeedback, View } from 'react-native';
import { Button, Checkbox, Text, TextInput } from 'react-native-paper';
import AgeGate from '../components/AgeGate';
import ScreenBackground from '../components/ScreenBackground';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { RootStackNavigationProp } from '../navigation/types';

type RegisterScreenProps = {
  navigation: RootStackNavigationProp;
};

const RegisterScreen: React.FC<RegisterScreenProps> = ({ navigation }) => {
  const { theme } = useTheme();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ageVerified, setAgeVerified] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  const handleAgeVerified = () => {
    setAgeVerified(true);
  };

  const handleAgeRejected = () => {
    Alert.alert(
      'Age Requirement Not Met',
      'You must be at least 13 years old to use Mint. We appreciate your interest!',
      [
        {
          text: 'OK',
          onPress: () => navigation.goBack(),
        },
      ]
    );
  };

  const handleRegister = async () => {
    if (!email || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    if (!termsAccepted) {
      setError('You must accept the Terms and Conditions to continue');
      return;
    }

    if (!privacyAccepted) {
      setError('You must accept the Privacy Policy to continue');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await signUp(email, password);
      // RootNavigator will handle navigation based on auth state
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign up');
    } finally {
      setLoading(false);
    }
  };

  // Show age gate first
  if (!ageVerified) {
    return (
      <AgeGate 
        onAgeVerified={handleAgeVerified}
        onAgeRejected={handleAgeRejected}
      />
    );
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <ScreenBackground style={styles.container}>
        <View style={{}}>
        <View style={styles.logoContainer}>
          <Image
            source={require('../assets/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={[styles.title, { color: theme.colors.text }]}>
            Create Account
          </Text>
        </View>

        <View style={styles.form}>
          <TextInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
            mode="outlined"
          />

          <TextInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
            mode="outlined"
          />

          <TextInput
            label="Confirm Password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            style={styles.input}
            mode="outlined"
          />

          <View style={styles.checkboxContainer}>
            <Checkbox
              status={termsAccepted ? 'checked' : 'unchecked'}
              onPress={() => setTermsAccepted(!termsAccepted)}
            />
            <Text style={[styles.checkboxText, { color: theme.colors.text }]}>
              I agree to the{' '}
              <Text 
                style={[styles.linkText, { color: theme.colors.primary }]}
                onPress={() => navigation.navigate('TermsAndConditions')}
              >
                Terms and Conditions
              </Text>
            </Text>
          </View>

          <View style={styles.checkboxContainer}>
            <Checkbox
              status={privacyAccepted ? 'checked' : 'unchecked'}
              onPress={() => setPrivacyAccepted(!privacyAccepted)}
            />
            <Text style={[styles.checkboxText, { color: theme.colors.text }]}>
              I agree to the{' '}
              <Text 
                style={[styles.linkText, { color: theme.colors.primary }]}
                onPress={() => navigation.navigate('PrivacyPolicy')}
              >
                Privacy Policy
              </Text>
            </Text>
          </View>

          {error && (
            <Text style={[styles.errorText, { color: theme.colors.error }]}>
              {error}
            </Text>
          )}

          <Button
            mode="contained"
            onPress={handleRegister}
            loading={loading}
            disabled={loading || !termsAccepted || !privacyAccepted}
            style={styles.button}
          >
            Sign Up
          </Button>
        </View>

        <View style={styles.footer}>
          <Text style={{ color: theme.colors.textSecondary }}>
            Already have an account?{' '}
          </Text>
          <Button
            mode="text"
            onPress={() => navigation.navigate('Login')}
            disabled={loading}
          >
            Sign In
          </Button>
        </View>
        </View>
      </ScreenBackground>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 48,
    marginBottom: 32,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  form: {
    gap: 16,
  },
  input: {
    backgroundColor: 'transparent',
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -8,
  },
  checkboxText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
  },
  linkText: {
    textDecorationLine: 'underline',
  },
  errorText: {
    textAlign: 'center',
  },
  button: {
    marginTop: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 'auto',
    paddingVertical: 16,
  },
});

export default RegisterScreen; 