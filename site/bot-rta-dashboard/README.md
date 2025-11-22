# Bot RTA Dashboard

**This is a separate Next.js project** within the monorepo.

## Project Type
- **Language**: TypeScript/JavaScript
- **Framework**: Next.js 16
- **Runtime**: Node.js
- **Package Manager**: npm

## Purpose
Web dashboard for visualizing and managing bot detection data from the CoinPoker detection tool.

## Key Features
- Real-time detection feed
- Configuration management
- Player tracking and analysis
- Threat visualization
- Export capabilities

## Development

```bash
npm install
npm run dev
```

Runs on `http://localhost:3001`

## API Endpoints

- `/api/signal` - Receives detection signals from detection tool
- `/api/configs` - Configuration management
- `/api/devices` - Device management
- `/api/players` - Player data
- `/api/history` - Historical data

## Important for AI Agents

⚠️ **This is a SEPARATE PROJECT** from the Python detection tool:
- Uses TypeScript/JavaScript, not Python
- Has its own `package.json` and dependencies
- Can be developed independently
- Communicates with detection tool via HTTP API only

**Do NOT modify Python files** (`*.py`) when working on dashboard features.
**Do NOT modify TypeScript files** (`*.ts`, `*.tsx`) when working on detection tool features.

