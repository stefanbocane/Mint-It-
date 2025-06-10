import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Surface } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

/**
 * React Error Boundary Component
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI instead of crashing
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error for debugging
    console.error('Error Boundary caught an error:', error, errorInfo);
    
    this.setState({
      error,
      errorInfo,
      hasError: true
    });
    
    // You could also log the error to an external service here
    // Analytics.logError(error, errorInfo);
  }

  handleRetry = () => {
    this.setState(prevState => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prevState.retryCount + 1
    }));
  };

  handleReportError = () => {
    const { error, errorInfo } = this.state;
    const errorReport = {
      error: error?.toString(),
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location?.href
    };

    console.log('Error Report:', errorReport);
    
    // In a real app, you would send this to your error reporting service
    // ErrorReportingService.sendReport(errorReport);
    
    alert('Error report generated. Check console for details.');
  };

  render() {
    if (this.state.hasError) {
      const { error, retryCount } = this.state;
      const { fallback, maxRetries = 3 } = this.props;
      
      // If a custom fallback is provided, use it
      if (fallback) {
        return fallback(error, this.handleRetry, retryCount);
      }

      // Default error UI
      return (
        <Surface style={styles.errorContainer} elevation={4}>
          <View style={styles.errorContent}>
            <Icon name="alert-circle-outline" size={64} color="#e74c3c" style={styles.errorIcon} />
            
            <Text style={styles.errorTitle}>Something went wrong</Text>
            
            <Text style={styles.errorMessage}>
              We encountered an unexpected error. This has been logged and will be investigated.
            </Text>
            
            {__DEV__ && (
              <View style={styles.debugInfo}>
                <Text style={styles.debugTitle}>Debug Information:</Text>
                <Text style={styles.debugText}>{error?.toString()}</Text>
              </View>
            )}
            
            <View style={styles.buttonContainer}>
              {retryCount < maxRetries && (
                <Button
                  mode="contained"
                  onPress={this.handleRetry}
                  icon="refresh"
                  style={styles.retryButton}
                >
                  Try Again ({maxRetries - retryCount} attempts left)
                </Button>
              )}
              
              <Button
                mode="outlined"
                onPress={this.handleReportError}
                icon="bug-outline"
                style={styles.reportButton}
              >
                Report Issue
              </Button>
              
              {this.props.onGoHome && (
                <Button
                  mode="text"
                  onPress={this.props.onGoHome}
                  icon="home"
                  style={styles.homeButton}
                >
                  Go to Home
                </Button>
              )}
            </View>
            
            {retryCount >= maxRetries && (
              <View style={styles.maxRetriesContainer}>
                <Text style={styles.maxRetriesText}>
                  Maximum retry attempts reached. Please restart the app or contact support.
                </Text>
              </View>
            )}
          </View>
        </Surface>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    margin: 16,
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  errorContent: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorIcon: {
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 12,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  debugInfo: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
    width: '100%',
    maxHeight: 150,
  },
  debugTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#495057',
    marginBottom: 8,
  },
  debugText: {
    fontSize: 12,
    color: '#6c757d',
    fontFamily: 'monospace',
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  retryButton: {
    marginBottom: 8,
  },
  reportButton: {
    marginBottom: 8,
  },
  homeButton: {
    marginTop: 8,
  },
  maxRetriesContainer: {
    backgroundColor: '#fff3cd',
    padding: 16,
    borderRadius: 8,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#ffeaa7',
  },
  maxRetriesText: {
    color: '#856404',
    textAlign: 'center',
    fontSize: 14,
  },
});

export default ErrorBoundary; 