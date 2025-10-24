import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Button, Checkbox, Text, TextInput } from 'react-native-paper';
import ScreenBackground from '../components/ScreenBackground';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useTheme } from '../contexts/ThemeContext';
import { RootStackNavigationProp } from '../navigation/types';

type LoginScreenProps = {
  navigation: RootStackNavigationProp;
};

const LoginScreen: React.FC<LoginScreenProps> = ({ navigation }) => {
  const { theme } = useTheme();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await signIn(email, password, rememberMe);
      // RootNavigator will handle navigation based on auth state
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenBackground style={styles.container}>
      <View style={{}}>
      <View style={styles.logoContainer}>
        <Image
          source={require('../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={[styles.title, { color: theme.colors.text }]}>
          Welcome to Mint
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

        <View style={styles.rememberMeContainer}>
          <Checkbox
            status={rememberMe ? 'checked' : 'unchecked'}
            onPress={() => setRememberMe(!rememberMe)}
          />
          <Text 
            style={{ color: theme.colors.text, marginLeft: 8 }}
            onPress={() => setRememberMe(!rememberMe)}
          >
            Remember me
          </Text>
        </View>

        {error && (
          <Text style={[styles.errorText, { color: theme.colors.error }]}>
            {error}
          </Text>
        )}

        <Button
          mode="contained"
          onPress={handleLogin}
          loading={loading}
          disabled={loading}
          style={styles.button}
        >
          Sign In
        </Button>
      </View>

      <View style={styles.footer}>
        <Text style={{ color: theme.colors.textSecondary }}>
          Don't have an account?{' '}
        </Text>
        <Button
          mode="text"
          onPress={() => navigation.navigate('Register')}
          disabled={loading}
        >
          Sign Up
        </Button>
      </View>
      </View>
    </ScreenBackground>
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
  rememberMeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -8,
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

export default LoginScreen; 