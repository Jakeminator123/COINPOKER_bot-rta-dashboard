#!/usr/bin/env node
/**
 * ESLint watch wrapper for Next.js
 * Fixes issue where 'next lint' interprets 'lint' as a directory when run via chokidar
 */

const { exec } = require('child_process');

// Get the project root (where package.json is)
const projectRoot = __dirname.replace(/[\\/]scripts$/, '');

function runLint() {
  console.log('[ESLint Watch] Running lint...');
  const cmd = 'npx --no-install eslint --max-warnings=0 .';
  exec(cmd, { cwd: projectRoot }, (error, stdout, stderr) => {
    if (stdout) {
      console.log(stdout);
    }
    if (stderr) {
      console.error(stderr);
    }
    if (error && error.code !== 1) {
      // Exit code 1 is normal for linting errors, ignore it
      console.error(`[ESLint Watch] Error: ${error.message}`);
    }
  });
}

// Run immediately
runLint();

// Export for chokidar
if (require.main === module) {
  // If run directly, just run lint once
  process.exit(0);
}

module.exports = { runLint };

