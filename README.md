# CoinPoker Bot Detection System

This is a **monorepo** containing two separate but related projects:

## Project Structure

```
detector/
├── scanner.py              # Detection tool entry point
├── core/                   # Detection tool core modules
├── segments/              # Detection segments
├── utils/                 # Detection tool utilities
├── site/
│   └── bot-rta-dashboard/ # Dashboard project (Next.js)
└── ...
```

## Projects

### 1. Detection Tool (Python)
**Location**: Root directory (`/`)

A Python-based bot detection system that monitors CoinPoker processes and detects suspicious activity. Sends detection signals to the dashboard via HTTP API.

**Key Files:**
- `scanner.py` - Main entry point
- `core/` - Core API and services
- `segments/` - Detection modules
- `utils/` - Utility functions

**Dependencies:** Python 3.x, see `requirements.txt`

### 2. Dashboard (Next.js)
**Location**: `site/bot-rta-dashboard/`

A Next.js web dashboard that receives and visualizes detection data from the detection tool. Provides configuration management, real-time monitoring, and reporting.

**Key Files:**
- `app/` - Next.js app directory
- `components/` - React components
- `lib/` - Utility libraries
- `configs/` - Configuration files

**Dependencies:** Node.js, see `site/bot-rta-dashboard/package.json`

## Important Notes for AI Agents

⚠️ **CRITICAL**: These are **TWO SEPARATE PROJECTS** in a monorepo:

1. **Detection Tool** (Python) - Standalone application that can run independently
2. **Dashboard** (Next.js) - Web application that receives data from detection tool

**They communicate via HTTP API** (`http://localhost:3001/api/signal`), but are **architecturally separate**:
- Different programming languages (Python vs TypeScript)
- Different dependency systems (pip vs npm)
- Different build processes
- Can be developed, tested, and deployed independently

**However**, they share:
- Configuration files (dashboard serves configs to detection tool)
- Data flow (detection tool → dashboard)
- Business logic (detection rules, scoring, etc.)

When working on this codebase:
- **Detection tool changes** should primarily affect files in root, `core/`, `segments/`, `utils/`
- **Dashboard changes** should primarily affect files in `site/bot-rta-dashboard/`
- **Shared logic** may require changes in both projects

## Development

### Detection Tool
```bash
python scanner.py
```

### Dashboard
```bash
cd site/bot-rta-dashboard
npm install
npm run dev
```

## Communication

The detection tool sends batch reports to the dashboard API endpoint:
- Endpoint: `http://localhost:3001/api/signal`
- Format: JSON array with detection signals
- Authentication: Token-based (configured in `config.txt`)

