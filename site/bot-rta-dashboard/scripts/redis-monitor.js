#!/usr/bin/env node
/**
 * Redis Monitor Script
 * 
 * Monitors and logs all Redis operations in real-time
 * Shows what data is being written to Redis with clear formatting
 * 
 * Usage:
 *   node scripts/redis-monitor.js
 *   node scripts/redis-monitor.js --output log.txt
 *   node scripts/redis-monitor.js --filter SET
 *   node scripts/redis-monitor.js --stats (run for 10s and show stats)
 */

const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');

// Load environment variables
// Try .env.local first, then fallback to .env
const envLocalPath = path.join(__dirname, '../.env.local');
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config(); // Try default locations
}

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Parse command line arguments
const args = process.argv.slice(2);
const outputFile = args.includes('--output') 
  ? args[args.indexOf('--output') + 1] 
  : null;
const filterCommand = args.includes('--filter')
  ? args[args.indexOf('--filter') + 1].toUpperCase()
  : null;
const showKeys = args.includes('--keys');
const statsOnly = args.includes('--stats');
const writeOnly = args.includes('--write-only') || !args.includes('--all'); // Default: only show writes

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

// Statistics
const stats = {
  commands: new Map(),
  keys: new Set(),
  startTime: Date.now(),
  totalCommands: 0,
};

// Log file stream
let logStream = null;
if (outputFile) {
  logStream = fs.createWriteStream(outputFile, { flags: 'a' });
  logStream.write(`\n=== Redis Monitor Started: ${new Date().toISOString()} ===\n`);
}

function log(message, color) {
  const timestamp = new Date().toISOString();
  const coloredMessage = color ? `${color}${message}${colors.reset}` : message;
  const logMessage = `[${timestamp}] ${message}`;
  
  console.log(coloredMessage);
  if (logStream) {
    logStream.write(logMessage + '\n');
  }
}

function parseRedisCommand(line) {
  // Redis MONITOR format: "+timestamp [db id IP:port] \"command\" \"arg1\" \"arg2\" ..."
  // Example: "+1762613750.688184 [0 88.21.41.98:58168] \"HGETALL\" \"device:...\""
  // Note: Starts with + and may have IP:port in brackets
  
  // Remove leading + if present
  const cleanLine = line.startsWith('+') ? line.substring(1) : line;
  
  // Match: timestamp [db id IP:port] "command" "args..."
  let match = cleanLine.match(/^(\d+\.\d+)\s+\[(\d+)(?:\s+[^\]]+)?\]\s+"([^"]+)"(.*)$/);
  
  if (!match) return null;

  const [, timestamp, dbId, command, argsStr] = match;
  const args = [];
  
  // Parse arguments (they're quoted, may contain escaped quotes)
  if (argsStr && argsStr.trim()) {
    const argRegex = /"((?:[^"\\]|\\.)*)"/g;
    let argMatch;
    while ((argMatch = argRegex.exec(argsStr)) !== null) {
      // Unescape quotes
      args.push(argMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    }
  }

  const key = args[0];
  const operation = command.toUpperCase();

  return {
    timestamp: parseFloat(timestamp).toFixed(3),
    command: command.toUpperCase(),
    args,
    key,
    operation,
  };
}

function formatKey(key) {
  if (!key) return '';
  
  // Color code by key pattern
  if (key.startsWith('device:')) {
    return `${colors.cyan}${key}${colors.reset}`;
  } else if (key.startsWith('player_summary:')) {
    return `${colors.green}${key}${colors.reset}`;
  } else if (key.startsWith('hist:') || key.startsWith('agg:') || key.startsWith('hourly:') || key.startsWith('minute:')) {
    return `${colors.yellow}${key}${colors.reset}`;
  } else if (key.startsWith('segment:') || key.startsWith('segments:')) {
    return `${colors.magenta}${key}${colors.reset}`;
  } else if (key.startsWith('session:')) {
    return `${colors.blue}${key}${colors.reset}`;
  } else if (key.startsWith('leaderboard:')) {
    return `${colors.bright}${key}${colors.reset}`;
  }
  return key;
}

function formatCommand(cmd) {
  const cmdColors = {
    'SET': colors.green,
    'HSET': colors.cyan,
    'HINCRBY': colors.yellow,
    'ZADD': colors.magenta,
    'SADD': colors.blue,
    'EXPIRE': colors.dim,
    'GET': colors.dim,
    'HGETALL': colors.dim,
    'ZRANGE': colors.dim,
    'MULTI': colors.dim,
    'EXEC': colors.dim,
  };
  
  return `${cmdColors[cmd] || ''}${cmd}${colors.reset}`;
}

function formatValue(value, maxLength = 100) {
  if (!value) return '';
  const str = String(value);
  if (str.length > maxLength) {
    return str.substring(0, maxLength) + '...';
  }
  return str;
}

function logCommand(parsed) {
  if (!parsed) return;
  
  const { command, args, key, operation } = parsed;
  
  // Filter if requested
  if (filterCommand && command !== filterCommand) {
    return;
  }
  
  // Filter out read-only commands by default (unless --all is specified)
  const readCommands = ['GET', 'HGETALL', 'HGET', 'ZRANGE', 'ZRANGEBYSCORE', 'SMEMBERS', 'KEYS', 'SCAN', 'EXISTS', 'TTL', 'TYPE'];
  if (writeOnly && readCommands.includes(command)) {
    // Still count for stats but don't log
    stats.commands.set(command, (stats.commands.get(command) || 0) + 1);
    stats.totalCommands++;
    if (key) {
      stats.keys.add(key);
    }
    return;
  }
  
  // Update statistics
  stats.commands.set(command, (stats.commands.get(command) || 0) + 1);
  stats.totalCommands++;
  if (key) {
    stats.keys.add(key);
  }
  
  // Format output based on command type
  let output = '';
  
  switch (command) {
    case 'SET':
      output = `${formatCommand(command)} ${formatKey(key || '')} = ${formatValue(args[1] || '', 200)}`;
      break;
      
    case 'HSET':
      const fieldCount = Math.floor((args.length - 1) / 2);
      const fields = args.slice(1);
      if (fieldCount === 1) {
        output = `${formatCommand(command)} ${formatKey(key || '')} [${fields[0]} = ${formatValue(fields[1] || '', 100)}]`;
      } else {
        output = `${formatCommand(command)} ${formatKey(key || '')} [${fieldCount} fields]`;
        // Show first few fields
        for (let i = 0; i < Math.min(4, fields.length); i += 2) {
          output += `\n  ${colors.dim}${fields[i]}${colors.reset} = ${formatValue(fields[i + 1] || '', 80)}`;
        }
        if (fields.length > 4) {
          output += `\n  ${colors.dim}... ${fieldCount - 2} more fields${colors.reset}`;
        }
      }
      break;
      
    case 'HINCRBY':
      output = `${formatCommand(command)} ${formatKey(key || '')} [${args[1]} += ${args[2]}]`;
      break;
      
    case 'ZADD':
      const score = args[1];
      const value = args[2];
      output = `${formatCommand(command)} ${formatKey(key || '')} [score: ${score}, value: ${formatValue(value || '', 80)}]`;
      break;
      
    case 'SADD':
      output = `${formatCommand(command)} ${formatKey(key || '')} [add: ${formatValue(args[1] || '', 80)}]`;
      break;
      
    case 'EXPIRE':
      output = `${formatCommand(command)} ${formatKey(key || '')} [TTL: ${args[1]}s]`;
      break;
      
    case 'EXEC':
      output = `${formatCommand(command)} [Transaction executed]`;
      break;
      
    case 'MULTI':
      output = `${formatCommand(command)} [Transaction started]`;
      break;
      
    default:
      output = `${formatCommand(command)} ${formatKey(key || '')} ${args.slice(1).map(a => formatValue(a, 50)).join(' ')}`;
  }
  
  log(output);
}

function printStats() {
  const runtime = ((Date.now() - stats.startTime) / 1000).toFixed(1);
  log(`\n${colors.bright}=== Statistics (${runtime}s runtime) ===${colors.reset}`);
  log(`Total commands: ${stats.totalCommands}`);
  log(`Unique keys: ${stats.keys.size}`);
  log(`\nCommands breakdown:`);
  
  const sortedCommands = Array.from(stats.commands.entries())
    .sort((a, b) => b[1] - a[1]);
  
  for (const [cmd, count] of sortedCommands) {
    const percentage = ((count / stats.totalCommands) * 100).toFixed(1);
    log(`  ${formatCommand(cmd)}: ${count} (${percentage}%)`);
  }
  
  log(`\nKey patterns:`);
  const keyPatterns = new Map();
  for (const key of stats.keys) {
    if (!key || typeof key !== 'string') continue;
    const pattern = (key.includes(':') ? key.split(':')[0] : key) + ':*';
    keyPatterns.set(pattern, (keyPatterns.get(pattern) || 0) + 1);
  }
  
  const sortedPatterns = Array.from(keyPatterns.entries())
    .sort((a, b) => b[1] - a[1]);
  
  for (const [pattern, count] of sortedPatterns) {
    log(`  ${formatKey(pattern)}: ${count} keys`);
  }
}

async function main() {
  log(`${colors.bright}Redis Monitor Starting...${colors.reset}`);
  log(`Redis URL: ${REDIS_URL.replace(/:[^:@]+@/, ':****@')}`); // Hide password
  log(`Filter: ${filterCommand || 'none'}`);
  log(`Mode: ${writeOnly ? colors.green + 'WRITE-ONLY (showing SET/HSET/ZADD/etc)' + colors.reset : colors.yellow + 'ALL COMMANDS (including reads)' + colors.reset}`);
  log(`Output file: ${outputFile || 'console only'}`);
  log(`${colors.dim}Tip: Use --all to see read operations too${colors.reset}`);
  log(`\n${colors.yellow}Press Ctrl+C to stop and show statistics${colors.reset}\n`);
  
  const client = createClient({ url: REDIS_URL });
  
  client.on('error', (err) => {
    log(`Redis error: ${err.message}`, colors.red);
    process.exit(1);
  });
  
  client.on('connect', () => {
    log(`Connected to Redis`, colors.green);
  });
  
  let monitorConn = null;
  let scanInterval = null;
  let monitorSocket = null;
  
  try {
    await client.connect();
    
    log(`${colors.yellow}Starting Redis MONITOR...${colors.reset}`);
    log(`${colors.dim}Using raw socket connection for MONITOR${colors.reset}\n`);
    
    // Track known keys for scanning fallback
    const knownKeys = new Set();
    
    // Try to use MONITOR via raw socket (most reliable)
    try {
      const net = require('net');
      const redisUrl = new URL(REDIS_URL);
      const host = redisUrl.hostname || 'localhost';
      const port = parseInt(redisUrl.port || '6379', 10);
      const password = redisUrl.password || null;
      const username = redisUrl.username || null;
      
      monitorSocket = net.createConnection(port, host, () => {
        log(`${colors.green}MONITOR socket connected to ${host}:${port}${colors.reset}`);
        
        // Authenticate if password is provided
        if (password) {
          if (username) {
            // Redis 6+ AUTH with username
            log(`${colors.dim}Authenticating as ${username}...${colors.reset}`);
            monitorSocket.write(`AUTH ${username} ${password}\r\n`);
          } else {
            // Legacy AUTH
            log(`${colors.dim}Authenticating...${colors.reset}`);
            monitorSocket.write(`AUTH ${password}\r\n`);
          }
        } else {
          // No auth needed, start monitoring
          monitorSocket.write('MONITOR\r\n');
        }
      });
      
      let authComplete = !password; // If no password, we're already "authenticated"
      let buffer = '';
      let isFirstData = true;
      let lastDataTime = Date.now();
      
      monitorSocket.on('data', (data) => {
        const dataStr = data.toString();
        
        // Handle authentication response
        if (!authComplete && password) {
          if (dataStr.includes('OK')) {
            log(`${colors.green}Authentication successful${colors.reset}\n`);
            authComplete = true;
            monitorSocket.write('MONITOR\r\n');
            return;
          } else if (dataStr.includes('ERR')) {
            log(`${colors.red}Authentication failed: ${dataStr}${colors.reset}`);
            log(`${colors.yellow}Falling back to key scanning...${colors.reset}\n`);
            startKeyScanning();
            return;
          }
        }
        
        // Track data reception
        if (authComplete) {
          lastDataTime = Date.now();
        }
        
        buffer += dataStr;
        const lines = buffer.split('\r\n');
        buffer = lines.pop() || ''; // Keep incomplete line
        
        for (const line of lines) {
          if (line.trim()) {
            // Skip OK response from MONITOR command
            if (line === 'OK' || line.trim() === 'OK') {
              if (isFirstData) {
                log(`${colors.green}MONITOR command accepted, waiting for commands...${colors.reset}\n`);
                isFirstData = false;
              }
              continue;
            }
            
            const parsed = parseRedisCommand(line);
            if (parsed) {
              logCommand(parsed);
            } else if (line.trim() && !line.startsWith('OK') && line.length > 10 && !line.includes('CLIENT SETINFO')) {
              // Skip CLIENT SETINFO and AUTH commands (internal)
              // Only log unparsed if it looks important
              if (!line.includes('AUTH') && !line.includes('CLIENT')) {
                // Log raw line for debugging (first 3 unparsed)
                if (stats.totalCommands < 3) {
                  log(`${colors.dim}[DEBUG] Unparsed: ${line.substring(0, 120)}${colors.reset}`);
                }
              }
            }
          }
        }
      });
      
      monitorSocket.on('error', (err) => {
        log(`${colors.yellow}MONITOR socket error, using key scanning fallback: ${err.message}${colors.reset}`);
        startKeyScanning();
      });
      
      monitorSocket.on('close', () => {
        log(`${colors.yellow}MONITOR socket closed${colors.reset}`);
        startKeyScanning();
      });
      
      monitorSocket.on('end', () => {
        log(`${colors.yellow}MONITOR socket ended${colors.reset}`);
        startKeyScanning();
      });
      
      // Add timeout to detect if MONITOR isn't receiving data
      const dataCheckInterval = setInterval(() => {
        const timeSinceLastData = Date.now() - lastDataTime;
        if (timeSinceLastData > 10000 && stats.totalCommands === 0 && authComplete) {
          log(`${colors.yellow}No Redis commands detected in 10 seconds.${colors.reset}`);
          log(`${colors.dim}Make sure scanner.py is running and sending batch reports.${colors.reset}`);
          log(`${colors.dim}Also check that USE_REDIS=true in .env.local${colors.reset}\n`);
          lastDataTime = Date.now(); // Reset to avoid spam
        }
      }, 10000);
      
    } catch (monitorErr) {
      log(`${colors.yellow}MONITOR not available, using key scanning: ${monitorErr.message}${colors.reset}`);
      startKeyScanning();
    }
    
    // Fallback: Scan for new keys periodically
    function startKeyScanning() {
      log(`${colors.yellow}Starting key scanning (every 2 seconds)...${colors.reset}\n`);
      
      scanInterval = setInterval(async () => {
      try {
        const cursor = 0;
        const keys = [];
        let currentCursor = cursor;
        
        do {
          const result = await client.scan(currentCursor, {
            MATCH: '*',
            COUNT: 1000
          });
          currentCursor = result.cursor;
          keys.push(...result.keys);
        } while (currentCursor !== 0);
        
        // Check for new keys
        for (const key of keys) {
          if (!knownKeys.has(key)) {
            knownKeys.add(key);
            const type = await client.type(key);
            log(`NEW KEY: ${formatKey(key)} (type: ${type})`, colors.green);
            
            // Show some data for new keys
            if (type === 'hash') {
              const hashData = await client.hGetAll(key);
              const fieldCount = Object.keys(hashData).length;
              log(`  ${formatCommand('HSET')} ${formatKey(key)} [${fieldCount} fields]`, colors.dim);
              // Show first few fields
              let count = 0;
              for (const [field, value] of Object.entries(hashData)) {
                if (count < 3) {
                  log(`    ${field} = ${formatValue(value, 60)}`, colors.dim);
                }
                count++;
              }
              if (fieldCount > 3) {
                log(`    ... ${fieldCount - 3} more fields`, colors.dim);
              }
            } else if (type === 'string') {
              const strData = await client.get(key);
              log(`  ${formatCommand('SET')} ${formatKey(key)} = ${formatValue(strData || '', 100)}`, colors.dim);
            }
          }
        }
      } catch (err) {
        log(`Scan error: ${err.message}`, colors.red);
      }
    }, 2000); // Scan every 2 seconds
    }
    
    // Handle stats-only mode
    if (statsOnly) {
      setTimeout(async () => {
        if (scanInterval) clearInterval(scanInterval);
        if (monitorSocket) monitorSocket.destroy();
        await client.quit();
        if (monitorConn) await monitorConn.quit();
        printStats();
        if (logStream) {
          logStream.end();
        }
        process.exit(0);
      }, 10000); // Run for 10 seconds
    }
    
    // Handle Ctrl+C
    const cleanup = async () => {
      log(`\n${colors.yellow}Stopping monitor...${colors.reset}`);
      if (scanInterval) clearInterval(scanInterval);
      if (monitorSocket) {
        monitorSocket.removeAllListeners();
        monitorSocket.destroy();
      }
      await client.quit();
      if (monitorConn) await monitorConn.quit();
      printStats();
      if (logStream) {
        logStream.end();
      }
      process.exit(0);
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    
  } catch (error) {
    log(`Failed to connect: ${error.message}`, colors.red);
    process.exit(1);
  }
}

main().catch((error) => {
  log(`Fatal error: ${error.message}`, colors.red);
  if (logStream) {
    logStream.end();
  }
  process.exit(1);
});
