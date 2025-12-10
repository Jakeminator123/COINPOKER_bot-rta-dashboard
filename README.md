# CoinPoker Bot & RTA Detection System

A comprehensive real-time bot and RTA (Real-Time Assistance) detection system for CoinPoker. This monorepo contains two interconnected projects that work together to monitor players and detect suspicious activity.

---

## 📁 Project Structure

```
detector/                              # MONOREPO ROOT
│
├── 🐍 DETECTION TOOL (Python)
│   ├── scanner.py                     # Main entry point - monitors CoinPoker
│   ├── core/                          # Core modules
│   │   ├── api.py                     # EventBus, ThreatManager, ReportBatcher
│   │   ├── forwarder.py               # Signal forwarding orchestration
│   │   ├── web_forwarder.py           # HTTP forwarding to dashboard
│   │   ├── redis_forwarder.py         # Direct Redis forwarding (bypasses HTTP)
│   │   ├── redis_command_client.py    # Redis-based command client
│   │   ├── command_client.py          # HTTP-based command client
│   │   ├── models.py                  # Data models (Signal, ActiveThreat)
│   │   ├── device_identity.py         # Device identification
│   │   ├── segment_loader.py          # Dynamic segment loading
│   │   └── redis_schema.py            # Redis key schema helpers
│   │
│   ├── segments/                      # Detection modules (modular architecture)
│   │   ├── auto/                      # Automation detection
│   │   │   └── automation_detector.py # Detects AutoHotKey, Python scripts, macros
│   │   ├── behaviour/                 # Behaviour analysis
│   │   │   └── behaviour_detector.py  # Mouse/keyboard pattern analysis
│   │   ├── network/                   # Network monitoring
│   │   │   ├── telegram_detector.py   # Telegram bot communication detection
│   │   │   ├── traffic_monitor.py     # Network traffic analysis
│   │   │   └── web_monitor.py         # GTO/RTA website detection
│   │   ├── programs/                  # Process analysis
│   │   │   ├── process_scanner.py     # Running process detection
│   │   │   ├── hash_and_signature_scanner.py  # VirusTotal integration
│   │   │   ├── content_analyzer.py    # File entropy/packer detection
│   │   │   └── obfuscation_detector.py # Code obfuscation detection
│   │   ├── screen/                    # Screen analysis
│   │   │   └── screen_detector.py     # Overlay/window detection
│   │   ├── security/                  # Security checks
│   │   │   └── mitm_detector.py       # Man-in-the-middle detection
│   │   └── vm/                        # Virtual machine detection
│   │       └── vm_detector.py         # VMware, VirtualBox, etc.
│   │
│   ├── utils/                         # Utility modules
│   │   ├── config_loader.py           # Configuration management (dashboard/cache/local)
│   │   ├── config_reader.py           # Config.txt parser
│   │   ├── nickname_detector.py       # Player nickname detection (OCR + UI Automation)
│   │   ├── email_detector.py          # Player email detection (UI Automation)
│   │   ├── take_snapshot.py           # Screenshot capture for commands
│   │   ├── kill_coinpoker.py          # Process termination utility
│   │   └── ...
│   │
│   ├── config.txt                     # Runtime configuration
│   └── requirements.txt               # Python dependencies
│
└── 🌐 DASHBOARD (Next.js)
    └── site/bot-rta-dashboard/
        ├── app/                       # Next.js App Router
        │   ├── page.tsx                # Home page (player overview with filters)
        │   ├── dashboard/page.tsx      # Player detail page (AI analysis)
        │   ├── player/[id]/page.tsx    # Public player profile page
        │   ├── devices/page.tsx        # Device management
        │   ├── settings/page.tsx       # Configuration UI
        │   └── api/                   # API routes
        │       ├── signal/route.ts     # Receives detection signals
        │       ├── devices/route.ts    # Device data endpoints
        │       ├── player/summary/route.ts  # Player summary data
        │       ├── configs/route.ts    # Configuration endpoints
        │       └── ...
        │
        ├── components/                # React components
        │   ├── ThreatVisualization.tsx # 3D threat gauge
        │   ├── DeviceListModule.tsx    # Player list component
        │   ├── AnalysisModal.tsx       # AI analysis modal
        │   └── ...
        │
        ├── lib/                       # Utility libraries
        │   ├── storage/               # Storage adapters (Redis/Memory)
        │   ├── redis/                 # Redis client and schema
        │   ├── detections/            # Detection logic and scoring
        │   └── device/                # Device management and transforms
        │
        └── package.json               # Node.js dependencies
```

---

## 🔧 Part 1: Detection Tool (Python)

### Overview
The Detection Tool is a Windows application that monitors CoinPoker for suspicious activity. It runs in the background, automatically starting when CoinPoker launches and stopping when it closes.

### Key Features
- **Multi-factor CoinPoker detection** - Identifies CoinPoker process using multiple indicators (process name, path, window class, child processes, UUID patterns)
- **Modular segment architecture** - Each detection type is a separate, configurable module
- **Real-time signal forwarding** - Sends detections to dashboard via HTTP or Redis
- **Threat scoring** - 4-level system (CRITICAL/ALERT/WARN/INFO) with point-based bot probability
- **Automatic batching** - Groups signals into unified reports (default: every 92s)
- **Player identification** - Detects player nickname and email from CoinPoker UI
- **Bidirectional communication** - Receives commands from dashboard (kill process, take snapshot)
- **Configuration management** - Loads configs from dashboard with local fallback

### Detection Segments

| Segment | Category | What it Detects | Interval |
|---------|----------|-----------------|----------|
| **ProcessScanner** | programs | Known bot processes, unsigned executables | 92s |
| **HashScanner** | programs | Malware via VirusTotal hash lookup | 92s |
| **ContentAnalyzer** | programs | High-entropy files, packers, obfuscation | 92s |
| **AutomationDetector** | auto | Python scripts, AutoHotKey, macros | 92s |
| **BehaviourDetector** | behaviour | Suspicious mouse/keyboard patterns | 92s |
| **WebMonitor** | network | GTO Wizard, RTA sites, solver tools | 92s |
| **TelegramDetector** | network | Bot tokens, Telegram API communication | 92s |
| **TrafficMonitor** | network | RDP, VNC, remote access connections | 92s |
| **ScreenDetector** | screen | Overlay windows, screen capture tools | 92s |
| **VMDetector** | vm | Virtual machines (VMware, VirtualBox, etc.) | 92s |
| **MITMDetector** | security | SSL interception, proxy detection | 92s |

### Player Identification

**Nickname Detection** (`utils/nickname_detector.py`):
- Primary method: UI Automation (pywinauto) - hooks into CoinPoker lobby window
- Fallback method: OCR with red text filtering (Tesseract)
- Sends `"Player Name Detected"` signal to dashboard
- Stored in Redis: `device:{id}` → `player_nickname`

**Email Detection** (`utils/email_detector.py`):
- Detects email from CoinPoker login window using UI Automation
- Runs once per session when login window is detected
- Sends `"Player Email Detected"` signal to dashboard
- Stored in Redis: `device:{id}` → `player_email`

### Signal Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ CoinPoker Scanner (scanner.py)                                  │
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐     │
│  │ Programs │   │ Network  │   │ Behaviour│   │    VM    │ ... │
│  │ Segment  │   │ Segment  │   │ Segment  │   │ Segment  │     │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘     │
│       │              │              │              │            │
│       └──────────────┴──────────────┴──────────────┘            │
│                              │                                  │
│                     ┌────────▼────────┐                         │
│                     │  post_signal()  │                         │
│                     └────────┬────────┘                         │
│                              │                                  │
│                     ┌────────▼────────┐                         │
│                     │   ThreatManager │  (deduplication,        │
│                     │                 │   scoring, aggregation)   │
│                     └────────┬────────┘                         │
│                              │                                  │
│                     ┌────────▼────────┐                         │
│                     │  ReportBatcher  │  (batch every 92s)       │
│                     └────────┬────────┘                         │
│                              │                                  │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│       ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│       │    HTTP     │  │   Redis   │  │   Local    │            │
│       │ Forwarder   │  │ Forwarder  │  │  Logging   │            │
│       └─────┬──────┘  └─────┬──────┘  └────────────┘            │
└─────────────┼───────────────┼───────────────────────────────────┘
              │               │
              ▼               ▼
       ┌────────────────────────────────────┐
       │         Dashboard (Next.js)        │
       │    POST /api/signal (batch data)   │
       │         or Redis pub/sub           │
       └────────────────────────────────────┘
```

### Installation & Running

```bash
# Install dependencies
pip install -r requirements.txt

# Run the scanner
python scanner.py

# Build executable (optional)
pyinstaller --onefile scanner.py
```

### Configuration (config.txt)

```ini
# Environment
ENV=PROD                    # DEV or PROD

# Forwarding Mode
FORWARDER_MODE=auto         # auto, web, or redis
                            # auto: Try Redis first, fallback to HTTP

# HTTP Forwarding (if FORWARDER_MODE=web or auto)
WEB=y                       # Enable HTTP forwarding
WEB_URL_PROD=https://your-dashboard.com/api/signal
SIGNAL_TOKEN=your-secret-token
WEB_FORWARDER_TIMEOUT=10

# Redis Forwarding (if FORWARDER_MODE=redis or auto)
REDIS_URL=redis://user:pass@host:port
REDIS_TTL_SECONDS=604800    # 7 days

# Dashboard Config Source
DASHBOARD_URL=https://your-dashboard.com/api  # For fetching configs

# Batching
BATCH_INTERVAL_HEAVY=92     # Unified batch interval (seconds)

# Segment intervals (seconds)
PROGRAMS=92                 # Process scan interval
AUTO=92                     # Automation check interval
NETWORK=92                  # Network monitor interval
BEHAVIOUR=92                # Behaviour analysis interval
VM=92                       # VM detection interval
SCREEN=92                   # Screen detection interval

# Runtime Flags
RAM_CONFIG=n                # n=disk cache, y=RAM only (tamper-proof)
TESTING_JSON=y              # Include metadata in batches
```

---

## 🌐 Part 2: Dashboard (Next.js)

### Overview
The Dashboard is a real-time web application that receives, visualizes, and analyzes detection data from the Detection Tool. It provides a comprehensive interface for monitoring players, viewing threat levels, and managing detection configurations.

### Features
- **Real-time player monitoring** - Live updates via Redis pub/sub or HTTP polling
- **Threat visualization** - Interactive 3D threat gauge and time-series charts
- **AI-powered analysis** - OpenAI integration for detection interpretation
- **Historical data** - Time-series charts showing threat trends over time
- **Configuration management** - Remote configuration for detection tool
- **Export functionality** - Excel reports and data exports
- **Authentication** - NextAuth with Google OAuth
- **Player profiles** - Individual player pages with nickname, email, IP, and detection history

### Key Pages

| Route | Description |
|-------|-------------|
| `/` | Player overview - all monitored players with segment filters |
| `/dashboard?device=<id>` | Individual player detail with AI analysis and real-time signals |
| `/player/[id]` | Public player profile page (historical data) |
| `/devices` | Device management and leaderboard |
| `/settings` | Detection configuration and segment settings |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/signal` | POST | Receives batch reports from detection tool |
| `/api/devices` | GET | List all devices with threat levels, nickname, email |
| `/api/player/summary` | GET | Player historical summary data |
| `/api/history` | GET | Historical detection data |
| `/api/analyze` | POST | AI analysis of player data |
| `/api/configs` | GET/POST | Configuration management |
| `/api/device-commands` | GET/POST | Send commands to detection tool |

### Installation & Running

```bash
cd site/bot-rta-dashboard

# Install dependencies
npm install

# Create .env.local file with required variables:
# NEXTAUTH_SECRET=your-secret
# NEXTAUTH_URL=http://localhost:3001
# REDIS_URL=redis://localhost:6379
# OPENAI_API_KEY=your-key (for AI analysis)
# SIGNAL_TOKEN=your-secret-token

# Run development server
npm run dev

# Build for production
npm run build
npm start
```

---

## 🔗 Communication Between Projects

### HTTP Mode (default)
```
Detection Tool  ──POST /api/signal──>  Dashboard
                                        │
Dashboard  ──GET /api/configs──>  Detection Tool (on startup)
```

### Redis Mode (real-time, recommended)
```
Detection Tool  ──PUBLISH signals──>  Redis  ──>  Dashboard (SUBSCRIBE)
                                        │
                ──HSET device data──>  Redis  ──>  Dashboard (HGETALL)
                                        │
                ──LPUSH commands──>    Redis  ──>  Detection Tool (polling)
```

### Data Format (Batch Report)

**Unified Batch Report** (sent every 92s):
```json
{
  "scan_type": "unified",
  "batch_number": 42,
  "bot_probability": 35.5,
  "nickname": "PlayerName",
  "device_id": "abc123...",
  "device_name": "DESKTOP-XYZ",
  "device_ip": "192.168.1.100",
  "timestamp": 1732531200.123,
  "aggregated_threats": [
    {
      "threat_id": "python",
      "name": "Python Script Active",
      "category": "auto",
      "status": "ALERT",
      "score": 10,
      "sources": ["auto/Python Interpreter Running"],
      "confidence": 2
    }
  ],
  "summary": {
    "critical": 0,
    "alert": 1,
    "warn": 2,
    "info": 5,
    "raw_detection_score": 20
  },
  "categories": {
    "programs": 2,
    "auto": 1,
    "network": 0
  }
}
```

**Player Identification Signals** (sent immediately when detected):
```json
{
  "category": "system",
  "name": "Player Name Detected",
  "status": "INFO",
  "details": "{\"player_name\":\"PlayerName\",\"confidence\":1.0,\"detection_method\":\"UIAutomation_Hook\"}",
  "device_id": "abc123...",
  "device_name": "DESKTOP-XYZ",
  "device_ip": "192.168.1.100"
}
```

```json
{
  "category": "system",
  "name": "Player Email Detected",
  "status": "INFO",
  "details": "{\"email\":\"player@example.com\",\"detection_method\":\"UIAutomation_Hook\"}",
  "device_id": "abc123...",
  "device_name": "DESKTOP-XYZ",
  "device_ip": "192.168.1.100"
}
```

### Redis Storage Structure

**Device Hash** (`device:{device_id}`):
```
device_id: "abc123..."
device_name: "DESKTOP-XYZ"
device_hostname: "DESKTOP-XYZ"
player_nickname: "PlayerName"
player_nickname_confidence: "100"
player_email: "player@example.com"
ip_address: "192.168.1.100"
last_seen: "1732531200"
threat_level: "35"
session_start: "1732530000"
```

**Batch Records** (`batch:{device_id}:{timestamp}`):
- JSON string containing full batch report with all detections

**Player Summary** (`player_summary:{device_id}`):
- JSON string with aggregated statistics (avg threat, total sessions, etc.)

---

## 🎯 Threat Scoring System

### Threat Levels
| Level | Points | Description | Examples |
|-------|--------|-------------|----------|
| CRITICAL | 15 | Known bots, direct RTA tools | Poker bots, solver tools |
| ALERT | 10 | High-risk automation, VM detected | AutoHotKey, Python scripts, VMs |
| WARN | 5 | Suspicious activity | Unsigned executables, overlays |
| INFO | 0 | Informational only | System events, heartbeats |

### Bot Probability Calculation
- Linear sum of active threat scores (deduplicated by threat_id)
- Capped at 100%
- Example: 1 ALERT (10) + 2 WARN (10) = 20% bot probability

### Threat Thresholds
- **High Risk**: >= 70% bot probability
- **Medium Risk**: 40-69% bot probability
- **Low Risk**: 10-39% bot probability
- **Clean**: < 10% bot probability

---

## 📦 Dependencies

### Detection Tool (Python)
- `pywin32` - Windows API access
- `psutil` - Process monitoring
- `requests` - HTTP client
- `pillow` + `pytesseract` - OCR for nickname detection
- `pywinauto` - UI Automation for nickname/email detection
- `redis` - Redis client
- `cryptography` - Config encryption
- `numpy` - Image processing for OCR

### Dashboard (Next.js)
- `next` - React framework
- `next-auth` - Authentication
- `redis` - Redis client
- `chart.js` + `react-chartjs-2` - Charts
- `framer-motion` - Animations
- `openai` - AI analysis
- `swr` - Data fetching
- `exceljs` - Excel export

---

## 🚀 Quick Start

### 1. Setup Detection Tool

```bash
# Install Python dependencies
pip install -r requirements.txt

# Configure (edit config.txt)
# Set REDIS_URL or WEB_URL_PROD
# Set SIGNAL_TOKEN
# Set DASHBOARD_URL

# Run scanner
python scanner.py
```

### 2. Setup Dashboard

```bash
cd site/bot-rta-dashboard

# Install Node.js dependencies
npm install

# Configure (create .env.local)
# NEXTAUTH_SECRET=your-secret
# NEXTAUTH_URL=http://localhost:3001
# REDIS_URL=redis://localhost:6379
# SIGNAL_TOKEN=your-secret-token

# Run dashboard
npm run dev
```

### 3. Access Dashboard

- Open `http://localhost:3001`
- Login with Google OAuth
- View players and detections in real-time

---

## 📋 Recent Updates

### ✅ Completed Features

- **Email Detection** - Detects player email from login window using UI Automation
- **Email Display** - Shows email in player profile and dashboard pages
- **Redis Integration** - Direct Redis forwarding for better performance
- **Bidirectional Commands** - Dashboard can send commands to detection tool
- **Player Identification** - Nickname and email detection and storage
- **Unified Batch Reports** - All detections grouped into single reports every 92s
- **Threat Deduplication** - Same threat only counted once per batch window
- **Configuration Management** - Remote config loading with local fallback

---

## 👥 Authors

**Conrad & Nina**

---

## 📄 License

Private - All rights reserved.
