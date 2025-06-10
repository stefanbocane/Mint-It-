import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Text } from 'react-native-paper';
import ScreenBackground from '../components/ScreenBackground';
import { useTheme } from '../contexts/ThemeContext';

const TermsAndConditionsScreen = ({ navigation }) => {
  const { theme } = useTheme();

  return (
    <ScreenBackground>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content title="Terms and Conditions" />
      </Appbar.Header>
      
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.colors.text }]}>
          Terms and Conditions for Mint
        </Text>
        
        <Text style={[styles.lastUpdated, { color: theme.colors.textSecondary }]}>
          Last Updated: 5/10/25
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          1. Acceptance of Terms
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          By using the Mint app ("the App"), you agree to be bound by these Terms and Conditions. If you do not agree with these terms, please do not use the App.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          2. Eligibility
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          You must be at least 13 years old to use Mint. By creating an account, you confirm that you meet this age requirement. We reserve the right to restrict access or delete accounts if we learn that a user is under the required age.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          3. User Accounts
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          To access certain features of the App, you must create an account. You agree to:{'\n'}
          • Provide accurate and complete information.{'\n'}
          • Keep your login credentials confidential.{'\n'}
          • Be solely responsible for all activity under your account.{'\n'}
          {'\n'}You may delete your account at any time through the app settings.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          4. Photo Uploads and User Content
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          Mint allows users to take photos using the app and submit them to a group-based auction system. You may take photos of others, provided it is lawful and consensual.{'\n'}
          {'\n'}You retain full ownership of your photos. By submitting them to Mint, you grant us a limited, non-exclusive, royalty-free license to store, display, and use your photos within the app to support gameplay features (e.g., bidding, scoring, downloading by the winning user). We do not use your content for advertising or external purposes.{'\n'}
          {'\n'}All photos must be taken using the in-app camera. Uploads from outside sources are not allowed.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          5. In-App Auctions and Currency
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          • Photos submitted are auctioned using in-game currency.{'\n'}
          • The winning bidder will have access to download the photo.{'\n'}
          • All auctions and trades are final and non-reversible.{'\n'}
          • In-game currency has no real-world monetary value.{'\n'}
          • We may update auction rules or currency features at any time.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          6. Prohibited Conduct
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          You agree not to:{'\n'}
          • Upload content that violates laws, is abusive, discriminatory, explicit, or otherwise harmful.{'\n'}
          • Impersonate others or misrepresent your identity.{'\n'}
          • Interfere with or disrupt the app, servers, or other users' experience.{'\n'}
          • Attempt to hack, reverse-engineer, or exploit any part of the App.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          7. Community Guidelines
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          To keep Mint safe and respectful for everyone, users are expected to follow these community standards:{'\n'}
          • Only take and share photos of others with their consent.{'\n'}
          • Avoid uploading content containing violence, hate speech, nudity, or harassment.{'\n'}
          • Report inappropriate content using the in-app reporting feature.{'\n'}
          {'\n'}Violation of these guidelines may result in content removal or account suspension.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          8. User Reporting and Moderation
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          Mint does not manually review photos. Instead, content moderation is driven by user reports. If you see content that violates these Terms or our community standards, please report it through the app. We will review flagged content and take appropriate action, which may include removal or account restriction.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          9. Intellectual Property
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          All content, code, and design elements of Mint (excluding user-uploaded photos) are the property of the developers. You may not copy, reproduce, or distribute any part of the App without written permission.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          10. Termination
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          We reserve the right to suspend or terminate your access to Mint at our sole discretion, particularly if you violate these Terms or applicable laws.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          11. Disclaimers
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          Mint is provided "as is" without warranties of any kind. We do not guarantee the availability, accuracy, or reliability of the App or any content.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          12. Limitation of Liability
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          To the fullest extent permitted by law, Mint's developers are not liable for any damages arising out of your use of the App, including but not limited to loss of data, account access, or in-app currency.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          13. Changes to Terms
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          We may update these Terms from time to time. Continued use of the App after changes means you accept the updated terms.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          14. Contact Us
        </Text>
        <Text style={[styles.sectionText, { color: theme.colors.text }]}>
          If you have questions about these Terms or need to report a violation, contact us at:{'\n'}
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
  sectionText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  bottomPadding: {
    height: 40,
  },
});

export default TermsAndConditionsScreen; 