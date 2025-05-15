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
  persistent: true
});

let timeout;

console.log('Watching for file changes... (Press Ctrl+C to stop)');

watcher
  .on('add', path => processChange('added', path))
  .on('change', path => processChange('modified', path))
  .on('unlink', path => processChange('deleted', path));

function processChange(changeType, path) {
  console.log(`File ${path} was ${changeType}`);
  
  // Clear any existing timeout
  if (timeout) clearTimeout(timeout);
  
  // Set a new timeout to commit changes after 5 seconds of no activity
  timeout = setTimeout(() => {
    console.log('Committing changes...');
    
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
      console.log(`Changes committed and pushed at ${new Date().toISOString()}`);
    });
  }, 5000); // 5 second delay before committing
}
