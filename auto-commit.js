const chokidar = require('chokidar');
const { exec } = require('child_process');

// Watch all files except those in .git, node_modules, and other ignored directories
const watcher = chokidar.watch('.', {
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
  ],
  ignoreInitial: true,
  persistent: true,
  usePolling: true,  // More reliable file watching
  interval: 100,     // Poll every 100ms
  binaryInterval: 300
});

console.log('Watching for file changes... (Press Ctrl+C to stop)');

// Track last commit time to prevent rapid-fire commits
let lastCommitTime = 0;
const MIN_COMMIT_INTERVAL = 1000; // 1 second between commits

watcher
  .on('add', path => processChange('added', path))
  .on('change', path => processChange('modified', path))
  .on('unlink', path => processChange('deleted', path));

function processChange(changeType, path) {
  const now = Date.now();
  
  // Skip if we've committed recently
  if (now - lastCommitTime < MIN_COMMIT_INTERVAL) {
    return;
  }
  
  console.log(`File ${path} was ${changeType}. Committing changes...`);
  
  const commands = [
    'git add .',
    `git commit -m "Auto-commit: ${new Date().toISOString()}"`,
    'git push origin main',
  ];
  
  exec(commands.join(' && '), (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return;
    }
    lastCommitTime = Date.now();
    console.log(`Changes committed and pushed at ${new Date().toISOString()}`);
  });
}
