# CoinPoker Bot & RTA Detection System

A comprehensive real-time bot and RTA (Real-Time Assistance) detection system for CoinPoker. This monorepo contains two interconnected projects that work together to monitor players and detect suspicious activity.

---

## 📁 Project Structure

```
detector/                              # MONOREPO ROOT
│
├── 🐍 DETECTION TOOL (Python)
│   ├── scanner.py                     # Main entry point
│   ├── core/                          # Core modules
│   │   ├── api.py                     # EventBus, ThreatManager, SignalBatcher
│   │   ├── forwarder.py               # Signal forwarding orchestration
│   │   ├── web_forwarder.py           # HTTP forwarding to dashboard
│   │   ├── redis_forwarder.py         # Redis pub/sub forwarding
│   │   ├── models.py                  # Data models (Signal, ActiveThreat)
│   │   ├── device_identity.py         # Device identification
│   │   └── segment_loader.py          # Dynamic segment loading
│   │
│   ├── segments/                      # Detection modules
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
│   │   ├── config_loader.py           # Configuration management
│   │   ├── nickname_detector.py       # OCR-based player name detection
│   │   ├── take_snapshot.py           # Screenshot capture
│   │   └── ...
│   │
│   ├── config.txt                     # Runtime configuration
│   └── requirements.txt               # Python dependencies
│
└── 🌐 DASHBOARD (Next.js)
    └── site/bot-rta-dashboard/
        ├── app/                       # Next.js App Router
        │   ├── page.tsx               # Home page (player overview)
        │   ├── dashboard/page.tsx     # Player detail page
        │   ├── settings/page.tsx      # Configuration UI
        │   ├── devices/page.tsx       # Device management
        │   └── api/                   # API routes
        │       ├── signal/route.ts    # Receives detection signals
        │       ├── devices/route.ts   # Device data endpoints
        │       ├── configs/route.ts   # Configuration endpoints
        │       └── ...
        │
        ├── components/                # React components
        │   ├── ThreatVisualization.tsx
        │   ├── DeviceListModule.tsx
        │   ├── AnalysisModal.tsx
        │   └── ...
        │
        ├── lib/                       # Utility libraries
        │   ├── redis.ts               # Redis client
        │   ├── detections/            # Detection logic
        │   └── device/                # Device management
        │
        └── package.json               # Node.js dependencies
```

---

## 🔧 Part 1: Detection Tool (Python)

### Overview
The Detection Tool is a Windows application that monitors CoinPoker for suspicious activity. It runs in the background, automatically starting when CoinPoker launches and stopping when it closes.

### Features
- **Multi-factor CoinPoker detection** - Identifies CoinPoker process using multiple indicators
- **Modular segment architecture** - Each detection type is a separate, configurable module
- **Real-time signal forwarding** - Sends detections to dashboard via HTTP or Redis
- **Threat scoring** - 4-level system (CRITICAL/ALERT/WARN/INFO)
- **Automatic batching** - Groups signals into unified reports (default: every 92s)

### Detection Segments

| Segment | Category | What it Detects |
|---------|----------|-----------------|
| **AutomationDetector** | auto | Python scripts, AutoHotKey, macros |
| **BehaviourDetector** | behaviour | Suspicious mouse/keyboard patterns |
| **ProcessScanner** | programs | Known bot processes, unsigned executables |
| **HashScanner** | programs | Malware via VirusTotal hash lookup |
| **ContentAnalyzer** | programs | High-entropy files, packers, obfuscation |
| **WebMonitor** | network | GTO Wizard, RTA sites, solver tools |
| **TelegramDetector** | network | Bot tokens, Telegram API communication |
| **TrafficMonitor** | network | RDP, VNC, remote access connections |
| **ScreenDetector** | screen | Overlay windows, screen capture tools |
| **VMDetector** | vm | Virtual machines (VMware, VirtualBox, etc.) |
| **MITMDetector** | security | SSL interception, proxy detection |

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
│                     │                 │   scoring, aggregation) │
│                     └────────┬────────┘                         │
│                              │                                  │
│                     ┌────────▼────────┐                         │
│                     │  ReportBatcher  │  (batch every 92s)      │
│                     └────────┬────────┘                         │
│                              │                                  │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│       ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│       │    HTTP    │  │   Redis    │  │   Local    │            │
│       │ Forwarder  │  │ Forwarder  │  │  Logging   │            │
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

# Forwarding
WEB=y                       # Enable HTTP forwarding
WEB_URL_PROD=https://your-dashboard.com
SIGNAL_TOKEN=your-secret-token
FORWARDER_MODE=auto         # auto, web, or redis

# Segment intervals (seconds)
PROGRAMS=120                # Process scan interval
AUTO=30                     # Automation check interval
NETWORK=30                  # Network monitor interval
BEHAVIOUR=30                # Behaviour analysis interval
VM=120                      # VM detection interval
SCREEN=30                   # Screen detection interval

# Batching
BATCH_INTERVAL_HEAVY=92     # Unified batch interval
```

---

## 🌐 Part 2: Dashboard (Next.js)

### Overview
The Dashboard is a real-time web application that receives, visualizes, and analyzes detection data from the Detection Tool.

### Features
- **Real-time player monitoring** - Live updates via Redis pub/sub or polling
- **Threat visualization** - Interactive 3D threat gauge and charts
- **AI-powered analysis** - OpenAI integration for detection interpretation
- **Historical data** - Time-series charts showing threat trends
- **Configuration management** - Remote configuration for detection tool
- **Export functionality** - PDF reports and Excel exports
- **Authentication** - NextAuth with Google OAuth

### Key Pages

| Route | Description |
|-------|-------------|
| `/` | Player overview - all monitored players |
| `/dashboard?device=<id>` | Individual player detail with AI analysis |
| `/devices` | Device management and leaderboard |
| `/settings` | Detection configuration and segment settings |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/signal` | POST | Receives batch reports from detection tool |
| `/api/devices` | GET | List all devices with threat levels |
| `/api/history` | GET | Historical detection data |
| `/api/analyze` | POST | AI analysis of player data |
| `/api/configs` | GET/POST | Configuration management |

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

### Redis Mode (real-time)
```
Detection Tool  ──PUBLISH signals──>  Redis  ──>  Dashboard (SUBSCRIBE)
                                        │
                ──HSET device data──>  Redis  ──>  Dashboard (HGETALL)
```

### Data Format (Batch Report)
```json
{
  "scan_type": "unified",
  "batch_number": 42,
  "bot_probability": 35.5,
  "nickname": "PlayerName",
  "device_id": "abc123...",
  "device_name": "DESKTOP-XYZ",
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
    "info": 5
  }
}
```

---

## 🎯 Threat Scoring System

### Threat Levels
| Level | Points | Description |
|-------|--------|-------------|
| CRITICAL | 15 | Known bots, direct RTA tools |
| ALERT | 10 | High-risk automation, VM detected |
| WARN | 5 | Suspicious activity |
| INFO | 0 | Informational only |

### Bot Probability Calculation
- Linear sum of active threat scores
- Capped at 100%
- Example: 1 ALERT (10) + 2 WARN (10) = 20% bot probability

---

## 📦 Dependencies

### Detection Tool (Python)
- `pywin32` - Windows API access
- `psutil` - Process monitoring
- `requests` - HTTP client
- `pillow` + `pytesseract` - OCR for nickname detection
- `redis` - Redis client
- `cryptography` - Config encryption

### Dashboard (Next.js)
- `next` - React framework
- `next-auth` - Authentication
- `redis` - Redis client
- `chart.js` - Charts
- `framer-motion` - Animations
- `openai` - AI analysis
- `swr` - Data fetching

---

## 👥 Authors

**Conrad & Nina**

---

## 📄 License

Private - All rights reserved.

