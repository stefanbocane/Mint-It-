import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { useAuth } from '../contexts/AuthContext';

const RegisterScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { signUp } = useAuth();

  const handleRegister = async () => {
    if (password !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }
    try {
      await signUp(email, password);
    } catch (error) {
      console.error('Registration error:', error);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create Account</Text>
      
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
      
      <TextInput
        label="Confirm Password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        mode="outlined"
        style={styles.input}
        secureTextEntry
      />
      
      <Button
        mode="contained"
        onPress={handleRegister}
        style={styles.button}
      >
        Create Account
      </Button>
      
      <Text style={styles.footerText}>
        Already have an account?{' '}
        <Text
          style={styles.link}
          onPress={() => navigation.navigate('Login')}
        >
          Sign in
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

export default RegisterScreen; 