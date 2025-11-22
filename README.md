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

## ⚠️ CRITICAL FOR AI AGENTS

**THIS IS A MONOREPO WITH TWO SEPARATE PROJECTS**

### 🔴 Detection Tool (Python)
- **Location**: Root directory (`/`)
- **Language**: Python
- **Files**: `*.py` in root, `core/`, `segments/`, `utils/`
- **Dependencies**: `pip` + `requirements.txt`
- **Entry**: `scanner.py`

### 🔵 Dashboard (Next.js)
- **Location**: `site/bot-rta-dashboard/`
- **Language**: TypeScript/JavaScript
- **Files**: `*.ts`, `*.tsx` in `site/bot-rta-dashboard/`
- **Dependencies**: `npm` + `package.json`
- **Entry**: `site/bot-rta-dashboard/app/page.tsx`

### 🔗 Communication
- **Detection Tool → Dashboard**: HTTP POST to `http://localhost:3001/api/signal`
- **Dashboard → Detection Tool**: Config API at `/api/configs`
- **They communicate via HTTP API only** - no direct code imports

### 📋 Rules for AI Agents

1. **ALWAYS check file location before editing**:
   - Files in `/`, `core/`, `segments/`, `utils/` = 🔴 Detection Tool (Python)
   - Files in `site/bot-rta-dashboard/` = 🔵 Dashboard (TypeScript)

2. **Do NOT mix project types**:
   - ❌ Do NOT modify Python files when working on dashboard
   - ❌ Do NOT modify TypeScript files when working on detection tool

3. **Dependencies are separate**:
   - Detection Tool: `pip install -r requirements.txt`
   - Dashboard: `cd site/bot-rta-dashboard && npm install`

4. **They are architecturally separate**:
   - Different languages (Python vs TypeScript)
   - Different dependency systems (pip vs npm)
   - Different build processes
   - Can be developed independently

5. **But they work together**:
   - Share configuration files (dashboard serves to detection tool)
   - Share data flow (detection tool → dashboard)
   - Share business logic (detection rules, scoring)

**See `.cursor/rules/monorepo-structure.mdc` for detailed rules that AI agents always read.**

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

