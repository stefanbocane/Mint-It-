import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Text } from 'react-native-paper';
import ScreenBackground from '../components/ScreenBackground';
import { useTheme } from '../contexts/ThemeContext';

const PrivacyPolicyScreen = ({ navigation }) => {
  const { theme } = useTheme();

  return (
    <ScreenBackground>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content title="Privacy Policy" />
      </Appbar.Header>
      
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.colors.text }]}>
          Privacy Policy for Mint
        </Text>
        
        <Text style={[styles.lastUpdated, { color: theme.colors.textSecondary }]}>
          Last Updated: 5/25/25
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          Introduction
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          Welcome to Mint. We are committed to protecting your privacy and handling your data with transparency and care. This Privacy Policy outlines what information we collect, how we use it, and your rights regarding your data. By using Mint, you agree to the practices described in this policy.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          1. Information We Collect
        </Text>
        
        <Text style={[styles.subsectionTitle, { color: theme.colors.text }]}>
          Account Information
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          We collect and store the following data when you create an account:{'\n'}
          • Email address{'\n'}
          • Password (securely hashed){'\n'}
          • [Planned] Phone number for future verification and communication{'\n'}
          • Authentication tokens{'\n'}
          • Device identifiers
        </Text>

        <Text style={[styles.subsectionTitle, { color: theme.colors.text }]}>
          Photo Data
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          When you submit a photo within the app, we collect:{'\n'}
          • The image itself{'\n'}
          • Timestamps associated with submission{'\n'}
          • Metadata excluding geolocation or EXIF data
        </Text>

        <Text style={[styles.subsectionTitle, { color: theme.colors.text }]}>
          In-App Activity
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          We collect data related to how you use the app, including:{'\n'}
          • Group membership and activity{'\n'}
          • Photo uploads and auction participation{'\n'}
          • Bids placed and in-game currency usage{'\n'}
          • Leaderboard or scoring data
        </Text>

        <Text style={[styles.subsectionTitle, { color: theme.colors.text }]}>
          Technical Information
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          • IP address{'\n'}
          • Device type, operating system, and crash logs{'\n'}
          • App usage statistics (collected via Firebase Analytics)
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          2. How We Use Your Information
        </Text>
        
        <Text style={[styles.subsectionTitle, { color: theme.colors.text }]}>
          To Provide Core App Functionality
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          • Manage accounts and authenticate users{'\n'}
          • Allow photo submission, group participation, and auction bidding{'\n'}
          • Track in-game currency, scores, and leaderboard rankings{'\n'}
          • Store user preferences and session data
        </Text>

        <Text style={[styles.subsectionTitle, { color: theme.colors.text }]}>
          To Improve the App
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          • Diagnose and fix bugs or crashes{'\n'}
          • Analyze anonymized usage data to enhance features and performance
        </Text>

        <Text style={[styles.subsectionTitle, { color: theme.colors.text }]}>
          To Communicate With You
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          • Send push notifications about app activity (e.g. bids, auction wins){'\n'}
          • Notify you of app updates or important policy changes
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          3. Data Storage and Security
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          Your data is stored using Google Firebase, which provides:{'\n'}
          • Firebase Authentication (user login/session management){'\n'}
          • Cloud Firestore (to store gameplay and group data){'\n'}
          • Firebase Storage (to store uploaded photos){'\n'}
          • Firebase Cloud Messaging (for push notifications){'\n'}
          {'\n'}All data is encrypted in transit via HTTPS. We also apply Firebase's built-in security rules to control access and protect your data.{'\n'}
          {'\n'}Some data may be cached locally on your device for performance:{'\n'}
          • Authentication tokens{'\n'}
          • Recent sessions{'\n'}
          • App preferences
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          4. Data Sharing
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          We do not sell your personal information to third parties.{'\n'}
          {'\n'}We may share data:{'\n'}
          • Within user groups (e.g., photo submissions and bids are visible to group members){'\n'}
          • With service providers such as Firebase to enable app functionality{'\n'}
          • With legal authorities, if required to comply with legal obligations or enforce our rights
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          5. Your Privacy Controls
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          You have control over your data. You can:{'\n'}
          • Manage notification settings within the app{'\n'}
          • Delete your account and its associated data{'\n'}
          • Request access to or export of your data by contacting us at: stefanbocane@gmail.com
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          6. Children's Privacy
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          Mint is not intended for children under the age of 13.{'\n'}
          {'\n'}We do not knowingly collect or store personal information from users under 13. If we become aware that we have collected data from a child under 13, we will delete it promptly.{'\n'}
          {'\n'}We implement an age verification screen during sign-up to help prevent underage access. Users under 13 will not be permitted to create accounts.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          7. International Data Transfers
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          Your information may be stored and processed in the United States or other countries where our service providers operate. These countries may have different data protection laws than your own. By using Mint, you consent to such transfers.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          8. Changes to This Policy
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          We may update this Privacy Policy from time to time. If we make material changes, we will notify you via the app or by email. Your continued use of Mint after changes are posted constitutes your acceptance of the revised policy.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          Contact Us
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          If you have any questions, concerns, or requests regarding this Privacy Policy, please contact us at:{'\n'}
          📧 stefanbocane@gmail.com
        </Text>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  lastUpdated: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    fontStyle: 'italic',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 8,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
  },
  sectionText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  bottomPadding: {
    height: 40,
  },
});

export default PrivacyPolicyScreen; 