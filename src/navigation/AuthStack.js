import { createNativeStackNavigator } from '@react-navigation/native-stack';
import BackgroundImage from '../components/BackgroundImage';
import LoginScreen from '../screens/LoginScreen';
import PrivacyPolicyScreen from '../screens/PrivacyPolicyScreen';
import RegisterScreen from '../screens/RegisterScreen';
import TermsAndConditionsScreen from '../screens/TermsAndConditionsScreen';

const Stack = createNativeStackNavigator();

const AuthStack = () => {
  return (
    <BackgroundImage>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="TermsAndConditions" component={TermsAndConditionsScreen} />
        <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />
      </Stack.Navigator>
    </BackgroundImage>
  );
};

export default AuthStack; 