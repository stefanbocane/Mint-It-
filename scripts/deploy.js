#!/usr/bin/env node

/**
 * Deployment Script for Cardmates App
 * 
 * This script automates the deployment process including:
 * - Pre-deployment checks
 * - Environment validation
 * - Build optimization
 * - Asset optimization
 * - Deployment execution
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  requiredEnvVars: [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'EXPO_PROJECT_ID'
  ],
  buildProfiles: {
    development: 'development',
    preview: 'preview',
    production: 'production'
  }
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkEnvironmentVariables() {
  log('🔍 Checking environment variables...', 'blue');
  
  const missing = [];
  for (const envVar of CONFIG.requiredEnvVars) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }
  
  if (missing.length > 0) {
    log('❌ Missing required environment variables:', 'red');
    missing.forEach(envVar => log(`   - ${envVar}`, 'red'));
    log('💡 Create a .env file with these variables or set them in your deployment environment', 'yellow');
    return false;
  }
  
  log('✅ All required environment variables are set', 'green');
  return true;
}

function runPreDeploymentChecks() {
  log('🔍 Running pre-deployment checks...', 'blue');
  
  try {
    // Check if node_modules exists
    if (!fs.existsSync('node_modules')) {
      log('📦 Installing dependencies...', 'yellow');
      execSync('npm install', { stdio: 'inherit' });
    }
    
    // Run linting
    log('🔧 Running linter...', 'blue');
    try {
      execSync('npm run lint', { stdio: 'inherit' });
      log('✅ Linting passed', 'green');
    } catch (error) {
      log('⚠️  Linting found issues, but continuing...', 'yellow');
    }
    
    // Run tests if they exist
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (packageJson.scripts && packageJson.scripts.test) {
      log('🧪 Running tests...', 'blue');
      try {
        execSync('npm test -- --watchAll=false', { stdio: 'inherit' });
        log('✅ Tests passed', 'green');
      } catch (error) {
        log('❌ Tests failed', 'red');
        return false;
      }
    }
    
    return true;
  } catch (error) {
    log(`❌ Pre-deployment checks failed: ${error.message}`, 'red');
    return false;
  }
}

function optimizeForProduction() {
  log('⚡ Optimizing for production...', 'blue');
  
  try {
    // Set production environment
    process.env.NODE_ENV = 'production';
    
    // Clear Expo cache
    log('🧹 Clearing Expo cache...', 'yellow');
    execSync('npx expo export:clear', { stdio: 'inherit' });
    
    // Prebuild if needed
    log('🔨 Running prebuild...', 'yellow');
    execSync('npx expo prebuild --clean', { stdio: 'inherit' });
    
    log('✅ Production optimization complete', 'green');
    return true;
  } catch (error) {
    log(`❌ Production optimization failed: ${error.message}`, 'red');
    return false;
  }
}

function buildApp(platform, buildProfile) {
  log(`🚀 Building ${platform} app with ${buildProfile} profile...`, 'blue');
  
  try {
    const command = `eas build --platform=${platform} --profile=${buildProfile} --non-interactive`;
    execSync(command, { stdio: 'inherit' });
    
    log(`✅ ${platform} build completed successfully`, 'green');
    return true;
  } catch (error) {
    log(`❌ ${platform} build failed: ${error.message}`, 'red');
    return false;
  }
}

function deployApp() {
  log('🚀 Starting deployment process...', 'cyan');
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const platform = args.find(arg => ['ios', 'android', 'all'].includes(arg)) || 'all';
  const buildProfile = args.find(arg => Object.values(CONFIG.buildProfiles).includes(arg)) || 'preview';
  
  log(`📱 Platform: ${platform}`, 'blue');
  log(`🔧 Build Profile: ${buildProfile}`, 'blue');
  
  // Step 1: Check environment variables
  if (!checkEnvironmentVariables()) {
    process.exit(1);
  }
  
  // Step 2: Run pre-deployment checks
  if (!runPreDeploymentChecks()) {
    process.exit(1);
  }
  
  // Step 3: Optimize for production
  if (buildProfile === 'production') {
    if (!optimizeForProduction()) {
      process.exit(1);
    }
  }
  
  // Step 4: Build the app
  const platforms = platform === 'all' ? ['ios', 'android'] : [platform];
  let buildSuccess = true;
  
  for (const targetPlatform of platforms) {
    if (!buildApp(targetPlatform, buildProfile)) {
      buildSuccess = false;
      break;
    }
  }
  
  if (buildSuccess) {
    log('🎉 Deployment completed successfully!', 'green');
    log('📱 You can monitor your build status at: https://expo.dev/accounts/your-account/projects/cardmates/builds', 'cyan');
  } else {
    log('❌ Deployment failed', 'red');
    process.exit(1);
  }
}

// Help function
function showHelp() {
  log('Cardmates Deployment Script', 'cyan');
  log('');
  log('Usage: node scripts/deploy.js [platform] [build-profile]', 'blue');
  log('');
  log('Platforms:', 'yellow');
  log('  ios      - Build for iOS only');
  log('  android  - Build for Android only');
  log('  all      - Build for both platforms (default)');
  log('');
  log('Build Profiles:', 'yellow');
  log('  development - Development build');
  log('  preview     - Preview build (default)');
  log('  production  - Production build');
  log('');
  log('Examples:', 'green');
  log('  node scripts/deploy.js ios production');
  log('  node scripts/deploy.js android preview');
  log('  node scripts/deploy.js all production');
}

// Main execution
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showHelp();
} else {
  deployApp();
} 