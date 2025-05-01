import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { useAuth } from '../contexts/AuthContext';

const LoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { signIn, signInWithGoogle, signInWithApple } = useAuth();

  const handleLogin = async () => {
    try {
      await signIn(email, password);
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome Back</Text>
      
      <TextInput
        label="Email"
        value={email}
        onChangeText={setEmail}
        mode="outlined"
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      
      <TextInput
        label="Password"
        value={password}
        onChangeText={setPassword}
        mode="outlined"
        style={styles.input}
        secureTextEntry
      />
      
      <Button
        mode="contained"
        onPress={handleLogin}
        style={styles.button}
      >
        Sign In
      </Button>
      
      <Button
        mode="outlined"
        onPress={signInWithGoogle}
        style={styles.button}
        icon="google"
      >
        Continue with Google
      </Button>
      
      <Button
        mode="outlined"
        onPress={signInWithApple}
        style={styles.button}
        icon="apple"
      >
        Continue with Apple
      </Button>
      
      <Text style={styles.footerText}>
        Don't have an account?{' '}
        <Text
          style={styles.link}
          onPress={() => navigation.navigate('Register')}
        >
          Sign up
        </Text>
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
  },
  input: {
    marginBottom: 15,
  },
  button: {
    marginTop: 10,
  },
  footerText: {
    textAlign: 'center',
    marginTop: 20,
  },
  link: {
    color: '#6200ee',
    fontWeight: 'bold',
  },
});

export default LoginScreen; 