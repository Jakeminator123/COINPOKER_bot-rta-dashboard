#!/usr/bin/env node

/**
 * Production start script that respects PORT environment variable
 * Required for Render.com deployment
 */

const { spawn } = require('child_process');

// Get port from environment or use default
const port = process.env.PORT || 3000;

console.log(`Starting Next.js on port ${port}...`);

// Start Next.js with the correct port
const nextProcess = spawn('npx', ['next', 'start', '-p', port], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    PORT: port
  }
});

// Handle process termination
nextProcess.on('error', (error) => {
  console.error('Failed to start Next.js:', error);
  process.exit(1);
});

nextProcess.on('exit', (code) => {
  process.exit(code || 0);
});

// Handle signals
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  nextProcess.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  nextProcess.kill('SIGINT');
});
