// https://docs.expo.dev/guides/using-eslint/
module.exports = {
  extends: ['expo', 'eslint:recommended'],
  env: {
    node: true,
    es6: true,
    'react-native/react-native': true,
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  ignorePatterns: ['dist/*', 'node_modules/*', '.expo/*'],
  rules: {
    // Add any custom rules for deployment readiness
    'no-console': 'warn',
    'no-debugger': 'error',
    'no-unused-vars': 'warn',
    'react-hooks/exhaustive-deps': 'warn',
  },
};
