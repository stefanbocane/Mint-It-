const chokidar = require('chokidar');
const { exec } = require('child_process');
const path = require('path');

// Configuration
const CONFIG = {
  // Only watch these directories
  watchPaths: [
    'src',
    'components',
    'screens',
    'config',
    'assets'
  ],
  ignored: [
    '**/node_modules/**',
    '**/.git/**',
    '**/.expo/**',
    '**/dist/**',
    '**/android/**',
    '**/ios/**',
    '**/build/**',
    '**/*.log',
    '**/*.tmp',
    '**/*.snap',
    '**/.DS_Store',
    '**/package-lock.json',
    '**/yarn.lock'
  ],
  // Only commit every 5 minutes at most
  minCommitInterval: 5 * 60 * 1000,
  // Batch changes for 10 seconds before committing
  batchWindow: 10 * 1000,
  // Only relevant files
  relevantExtensions: ['.js', '.jsx', '.ts', '.tsx', '.json', '.md']
};

let changeQueue = new Set();
let commitTimeout = null;
let lastCommitTime = 0;

const watcher = chokidar.watch(CONFIG.watchPaths, {
  ignored: CONFIG.ignored,
  ignoreInitial: true,
  persistent: true,
  usePolling: false, // Use native file system events
  atomic: 1000, // Stabilization time for atomic writes
  awaitWriteFinish: {
    stabilityThreshold: 1000,
    pollInterval: 100
  }
});

console.log('Watching for file changes (press Ctrl+C to stop)...');
console.log(`Watching paths: ${CONFIG.watchPaths.join(', ')}`);

function shouldProcessFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return CONFIG.relevantExtensions.includes(ext);
}

function processChange(changeType, filePath) {
  if (!shouldProcessFile(filePath)) return;
  
  const now = Date.now();
  const timeSinceLastCommit = now - lastCommitTime;
  
  // Skip if we just committed
  if (timeSinceLastCommit < CONFIG.minCommitInterval) {
    if (timeSinceLastCommit < 60000) { // Less than 1 minute
      console.log(`Skipping change (${changeType}): ${filePath} - too soon after last commit`);
    }
    return;
  }
  
  // Add to queue
  changeQueue.add(`${changeType}: ${filePath}`);
  
  // Clear any pending timeout
  if (commitTimeout) {
    clearTimeout(commitTimeout);
  }
  
  // Schedule commit
  commitTimeout = setTimeout(commitChanges, CONFIG.batchWindow);
}

function commitChanges() {
  const now = Date.now();
  const timeSinceLastCommit = now - lastCommitTime;
  
  // Skip if we've committed recently
  if (timeSinceLastCommit < CONFIG.minCommitInterval) {
    console.log('Skipping commit - too soon after last commit');
    return;
  }
  
  // Skip if no changes
  if (changeQueue.size === 0) {
    return;
  }
  
  const changes = Array.from(changeQueue).join('\n  - ');
  console.log(`Committing ${changeQueue.size} changes...`);
  
  const commitMessage = `Auto-commit at ${new Date().toISOString()}\n\nChanges:\n  - ${changes}`;
  
  const commands = [
    'git add .',
    `git commit -m "${commitMessage.replace(/"/g, '\\"')}"`,
    'git pull --rebase origin main',
    'git push origin main'
  ];
  
  exec(commands.join(' && '), (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      return;
    }
    if (stderr && !stderr.includes('Your branch is up to date')) {
      console.error(`stderr: ${stderr}`);
    }
    
    lastCommitTime = Date.now();
    console.log(`Changes committed and pushed at ${new Date().toISOString()}`);
    changeQueue.clear();
  });
}

// Watch for changes
watcher
  .on('add', path => processChange('added', path))
  .on('change', path => processChange('modified', path))
  .on('unlink', path => processChange('deleted', path))
  .on('error', error => console.error(`Watcher error: ${error}`));

// Clean up on exit
process.on('SIGINT', () => {
  console.log('Stopping watcher...');
  watcher.close().then(() => {
    process.exit();
  });
});
