import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'YOUR_SENTRY_DSN',
  // Set tracesSampleRate to 1.0 to capture 100% of transactions for performance monitoring.
  tracesSampleRate: 1.0,
  // Set profilesSampleRate to 1.0 to profile every transaction.
  profilesSampleRate: 1.0,
});

export const captureError = (error, context = {}) => {
  Sentry.captureException(error, {
    extra: context,
  });
};

export const captureMessage = (message, level = 'info') => {
  Sentry.captureMessage(message, {
    level,
  });
}; 