# CoinPoker Bot Detection Platform  
## Comprehensive Technical & Business Report

> **Audience:** CoinPoker executives, administrators, security analysts, and engineering teams  
> **Version:** 1.0  
> **Date:** November 2025  

---

## Executive Summary

The CoinPoker Bot Detection Platform is a production-grade, dual-component system designed to continuously monitor CoinPoker endpoints for bot activity, real-time assistance (RTA) tools, and automation threats. It consists of:

1. **Detection Scanner Service (Python → Windows .EXE)**: A modular monitoring agent that runs as a Windows service on player machines, capturing nicknames via OCR, executing multi-segment threat detection, and forwarding unified batches to the backend every ~92 seconds.

2. **Admin Dashboard (Next.js + Redis)**: A secure backend UI for CoinPoker administrators, providing real-time visualization, player/device profiling, threat analytics, historical reporting, and SSE-based live feeds.

**Key Reminder**: The scanner will ultimately be packaged as a signed Windows `.exe` running as a service, ensuring continuous monitoring without user interaction. The dashboard is exclusively for CoinPoker admin and security teams.

---

## Table of Contents

1. [Repository Architecture](#1-repository-architecture)
2. [Scanner Project (Python Service)](#2-scanner-project-python-service)
3. [Dashboard Project (Next.js Backend)](#3-dashboard-project-nextjs-backend)
4. [Integration Contract](#4-integration-contract)
5. [Deployment & Infrastructure](#5-deployment--infrastructure)
6. [Engineering Effort & Valuation](#6-engineering-effort--valuation)
7. [Recommendations](#7-recommendations)
8. [Appendices](#8-appendices)

---

## 1. Repository Architecture

The project follows a **monorepo** structure, housing both the Python detection tool and the Next.js dashboard in a single repository for streamlined version control and coordinated releases.

```
detector/                           # Monorepo root
├── config.txt                      # Master configuration (env, endpoints, tokens, intervals)
├── scanner.py                      # Main detection runner (→ Windows service/EXE)
├── simulator.py                    # Load/stress simulator with identical batch format
│
├── core/                           # Shared Python modules
│   ├── api.py                      # API helpers, batch builders
│   ├── redis_forwarder.py          # Redis publishing, nickname propagation
│   ├── web_forwarder.py            # HTTP POST to dashboard (/api/signal)
│   ├── forwarder.py                # Base forwarder interface
│   ├── report_batcher.py           # Signal aggregator (~92s intervals)
│   ├── models.py                   # DetectionSignal, BatchReport, DeviceState
│   ├── device_identity.py          # Hardware fingerprinting
│   ├── system_info.py              # OS, CPU, RAM collection
│   ├── segment_loader.py           # Dynamic segment initialization
│   ├── redis_schema.py             # Redis key naming conventions
│   └── command_client.py           # Remote command listener (optional)
│
├── segments/                       # Detection modules
│   ├── auto/
│   │   └── automation_detector.py  # Macro & scripting detection
│   ├── behaviour/
│   │   └── behaviour_detector.py   # Gameplay cadence anomalies
│   ├── network/
│   │   ├── web_monitor.py          # HTTP/HTTPS pattern analysis
│   │   ├── traffic_monitor.py      # Packet inspection
│   │   └── telegram_detector.py    # Messaging app checks
│   ├── programs/
│   │   ├── process_scanner.py      # Running process inspection
│   │   ├── hash_and_signature_scanner.py  # Binary hash checks
│   │   ├── obfuscation_detector.py # Packed/encrypted binaries
│   │   └── content_analyzer.py     # Executable content heuristics
│   ├── screen/
│   │   └── screen_detector.py      # Screen capture/overlay detection
│   └── vm/
│       └── vm_detector.py          # Virtualization artifacts
│
├── utils/                          # Helper utilities
│   ├── config_loader.py            # Config reader with encryption/cache
│   ├── config_reader.py            # Legacy config parser
│   ├── nickname_detector.py        # OCR pipeline for player names
│   ├── file_encryption.py          # AES config cache encryption
│   ├── admin_check.py              # Privilege validation
│   ├── signal_logger.py            # Structured logging
│   ├── detection_keepalive.py      # Heartbeat generator
│   ├── take_snapshot.py            # Debug screenshot utility
│   └── runtime_flags.py            # Feature flags
│
├── batch_logs/                     # Batch export directory
│   ├── README_BATCH_STRUCTURE.md   # Batch schema documentation
│   └── example_batch_structure.json
│
└── site/
    └── bot-rta-dashboard/          # Next.js admin dashboard
        ├── app/                    # App Router (pages + API routes)
        │   ├── page.tsx            # Overview (devices, live feed)
        │   ├── dashboard/page.tsx  # Analytics (threat meter, charts)
        │   ├── devices/page.tsx    # Device explorer
        │   ├── players/[id]/page.tsx  # Player profile
        │   └── api/
        │       ├── signal/route.ts      # HTTP batch ingestion
        │       ├── devices/route.ts     # Device list endpoint
        │       ├── players/route.ts     # Player summaries
        │       ├── snapshot/route.ts    # Snapshot data
        │       ├── stream/route.ts      # SSE realtime feed
        │       ├── history/             # Historical aggregations
        │       └── configs/route.ts     # Optional config feed
        ├── components/
        │   ├── DeviceListModule.tsx     # Main search/filter UI
        │   ├── charts/                  # Threat meter, breakdown, trends
        │   └── modals/                  # Analysis, export, filters
        ├── lib/
        │   ├── storage/
        │   │   ├── redis-store.ts       # Redis client, snapshot builder
        │   │   ├── memory-store.ts      # In-memory fallback
        │   │   └── storage-adapter.ts   # Unified interface
        │   ├── device/
        │   │   ├── transform.ts         # Nickname/hostname merge
        │   │   └── device-name-utils.ts # Display name helpers
        │   ├── redis/schema.ts          # Key names, TTLs
        │   ├── detections/sections.ts   # Section routing logic
        │   └── utils/
        ├── public/                      # Static assets
        └── package.json                 # Next.js dependencies
```

**Git Repositories**:
- Full monorepo: `https://github.com/Jakeminator123/COINPOKER_bot-rta-dashboard` (branch `main`)
- Dashboard-only subtree: `https://github.com/Jakeminator123/COINPOKER_SITE__bot-rta-dashboard` (branch `main`)

---

## 2. Scanner Project (Python Service)

### 2.1 Purpose & Deployment

**Purpose**: Continuously monitor CoinPoker client endpoints for indicators of bot usage, real-time assistance tools, automation scripts, and virtualized environments. Capture player nicknames early and forward comprehensive detection batches to the backend.

**Deployment Target**: The scanner is intended to be packaged as a **signed Windows `.exe`** running as a **Windows service**. This ensures:
- Auto-start on system boot
- Survives user logouts and reboots
- Minimal user interaction required
- Elevated privileges for process/network inspection
- Centralized logging for SOC/audit trails

### 2.2 Core Components

#### 2.2.1 Entry Point (`scanner.py`)
- Orchestrates segment initialization, config loading, nickname detection, batch aggregation, and forwarding.
- Coordinates timing loops, handles exceptions, and logs lifecycle events.

#### 2.2.2 Configuration System
- **`config.txt`**: Master configuration defining:
  - Environment (`ENV=DEV` or `PROD`)
  - Endpoints (`WEB_URL_DEV`, `WEB_URL_PROD`, `REDIS_URL`)
  - Tokens (`SIGNAL_TOKEN`, `ADMIN_TOKEN`)
  - Intervals (`BATCH_INTERVAL_HEAVY`, `HEARTBEAT_SECONDS`)
  - Flags (`FORWARDER_MODE=redis`, `USE_REDIS=true`, `NEW_BATCHES_LOG=y`)
- **`utils/config_loader.py`**: Reads `config.txt`, merges environment variables, supports encrypted cache for offline operation.

#### 2.2.3 Nickname Detection
- **`utils/nickname_detector.py`**: Waits for the CoinPoker lobby window, captures screen region, applies red-channel OCR filtering, extracts player nickname with confidence scoring.
- Emits "Player Name Detected" signal before gameplay begins, ensuring nickname is available for all subsequent batches.

#### 2.2.4 Detection Segments

Each segment under `segments/` implements specialized checks:

| Segment | Module | Detects |
| --- | --- | --- |
| **Programs** | `process_scanner.py` | Running processes (HUDs, solvers, remote tools) |
|  | `hash_and_signature_scanner.py` | Known malicious binaries via hash/signature |
|  | `obfuscation_detector.py` | Packed or encrypted executables |
|  | `content_analyzer.py` | Suspicious executable content |
| **Network** | `web_monitor.py` | HTTP/HTTPS patterns to solver sites |
|  | `traffic_monitor.py` | Packet inspection for external comms |
|  | `telegram_detector.py` | Messaging app activity during play |
| **Automation** | `automation_detector.py` | Macros, scripting frameworks, auto-clickers |
| **Behavior** | `behaviour_detector.py` | Gameplay timing anomalies, superhuman cadence |
| **VM** | `vm_detector.py` | Hypervisor artifacts, virtual hardware |
| **Screen** | `screen_detector.py` | Screen capture tools, overlays |

Each segment yields `DetectionSignal` objects with:
- `threat_id`: Unique identifier
- `severity`: `INFO`, `WARN`, `ALERT`, `CRITICAL`
- `source`: Segment name
- `description`: Human-readable details
- `threat_points`: Numeric risk contribution

#### 2.2.5 Batch Aggregation
- **`core/report_batcher.py`**: Collects signals into unified batches every ~92 seconds (configurable).
- Deduplicates threats, calculates aggregate scores, organizes by category.
- Batch structure (see `batch_logs/README_BATCH_STRUCTURE.md`):
  - `scan_type`: "unified"
  - `batch_number`: Sequential ID
  - `bot_probability`: 0-100 threat score
  - `nickname`: Player name from OCR
  - `timestamp`: Unix epoch
  - `summary`: Counts by severity (`critical`, `alert`, `warn`, `info`)
  - `categories`: Counts by segment (`programs`, `network`, `behaviour`, `auto`, `vm`, `screen`)
  - `aggregated_threats`: Deduplicated threat list
  - `segments`: Raw per-segment reports
  - `device`: Hardware/OS metadata (hostname, IP, CPU, RAM, OS)
  - `metadata`: Config version, batch interval, session ID

### 2.3 Runtime Pipeline

```
[Scanner Startup]
    ↓
[Load config.txt + env vars]
    ↓
[Initialize segments]
    ↓
[Wait for CoinPoker lobby]
    ↓
[Nickname OCR (3 attempts, high confidence)]
    ↓
[Emit "Player Name Detected" signal]
    ↓
[Start segment loops (parallel threads)]
    ↓
[Batch aggregator collects signals every ~92s]
    ↓
[Forwarder sends batch]
    ├── HTTP Mode → POST /api/signal
    └── Redis Mode → Write device:{id}, batch:{device}:{timestamp}
    ↓
[Repeat until CoinPoker exits or service stops]
```

### 2.4 Forwarders (HTTP vs Redis)

#### HTTP Mode (`web_forwarder.py`)
- POSTs JSON batches to `http://.../api/signal` with `SIGNAL_TOKEN` header.
- Synchronous, requires dashboard to be online.
- Suitable when centralized ingestion is preferred.

#### Redis Mode (`redis_forwarder.py`)
- Writes directly to Redis Cloud using shared schema:
  - `device:{id}` hash: `player_nickname`, `player_nickname_confidence`, `device_hostname`, `device_name`, `ip_address`, `status`, `last_seen`, etc.
  - `batch:{device}:{timestamp}`: Full batch JSON as string.
  - Sorted sets for recency (`recent_devices`), categories, etc.
- Asynchronous, resilient to dashboard downtime.
- Dashboard reads from same keys, no HTTP dependency.
- Nickname signals now update both device hashes and batch metadata, ensuring consistency.

### 2.5 Simulator

**`simulator.py`**: Generates realistic batch payloads for thousands of synthetic players without touching production machines.

- Reads same `config.txt` (endpoints, tokens, intervals).
- Randomizes threats across all segments, mimicking scanner behavior.
- CLI arguments:
  - `--players`: Number of simulated players (default 10, scales to 2000+)
  - `--duration`: Test duration in minutes
  - `--interval`: Batch interval override
  - `--mode`: `http` or `redis`
- Use case: Load-test dashboard, stress Redis, validate scaling assumptions.

### 2.6 Operational Considerations

- **Service Packaging**: Use PyInstaller or similar to bundle `scanner.py` + dependencies into a single `.exe`. Configure as Windows service with auto-restart policy.
- **Privileges**: Requires admin/elevated privileges for process inspection, network monitoring, screen capture.
- **Logging**: Structured logs to file + stdout, including OCR confidence, forwarder mode, config source. Consider centralizing logs (e.g., Syslog, ELK stack).
- **Security**: Config encryption (`file_encryption.py`) protects tokens on operator machines. Token rotation should be coordinated with dashboard.
- **Updates**: Service can pull updated configs from `/api/configs` or use encrypted cache. Version mismatches logged for audit.

---

## 3. Dashboard Project (Next.js Backend)

### 3.1 Audience & Purpose

**Audience**: CoinPoker administrators, security analysts, compliance officers.

**Purpose**: Provide a secure, real-time backend to:
- Visualize live detections and threat analytics.
- Profile devices and players (nicknames, hostnames, IDs, risk scores).
- Review historical trends and export data for reporting.
- Manage device/player metadata and respond to incidents.

### 3.2 Project Structure (`site/bot-rta-dashboard`)

```
app/
  page.tsx                   # Overview: online devices, stats cards, live feed
  dashboard/page.tsx         # Analytics: threat meter, category breakdown, historical charts
  devices/page.tsx           # Device-centric exploration with filters/search
  players/[id]/page.tsx      # Player profiles (nickname, hostname, IDs, recent batches)
  api/
    signal/route.ts          # HTTP batch ingestion (validates SIGNAL_TOKEN)
    devices/route.ts         # Returns normalized device list
    players/route.ts         # Player summaries, filters, search
    snapshot/route.ts        # Snapshot data for SSE/overview
    stream/route.ts          # Server-Sent Events (SSE) for live updates
    history/
      hour/route.ts          # Hourly aggregation
      day/route.ts           # Daily aggregation
      session/route.ts       # Per-session stats
    configs/route.ts         # Optional config feed for scanner
    auth/[...nextauth]/      # NextAuth routes

components/
  DeviceListModule.tsx       # Search/filter UI (accessible labels, IDs)
  charts/
    types.ts                 # Chart type definitions
    constants.ts             # Color schemes, thresholds
    hooks/
      useChartData.ts        # Data fetching logic
      useChartConfig.ts      # Chart configuration
      useChartProcessing.ts  # Data transformations
      useSessionData.ts      # Session-specific data
  modals/
    AnalysisModal.tsx        # Deep-dive threat analysis
    ReportExportModal.tsx    # Export controls
    FilterModal.tsx          # Advanced filters

lib/
  storage/
    redis-store.ts           # Redis client, snapshot builder, SSE cache
    memory-store.ts          # In-memory fallback (HTTP-only mode)
    storage-adapter.ts       # Unified storage interface
    device-session.ts        # Session state management
  device/
    transform.ts             # Merges nickname, hostname, IP, risk scoring
    device-name-utils.ts     # Display name prioritization
  redis/
    schema.ts                # Key names, TTL constants
  detections/
    sections.ts              # Maps detection types to dashboard sections
  utils/
    store.ts                 # Storage layer selector (Redis vs Memory)
    api-utils.ts             # Fetch helpers
  auth/
    auth-config.ts           # NextAuth configuration

public/                      # Static assets (logos, icons)
package.json                 # Dependencies: Next.js, React, Tailwind, Redis
.env.local                   # Environment variables (REDIS_URL, tokens, etc.)
```

### 3.3 Data Flow & Features

#### 3.3.1 Ingestion
- **HTTP Path**: `/api/signal` validates `SIGNAL_TOKEN`, normalizes batch, forwards to storage layer.
- **Redis Direct**: Scanner writes to Redis, dashboard reads same keys via `redis-store.ts`.

#### 3.3.2 Storage Layer
- **`RedisStore`** (primary):
  - Reads/writes device hashes (`device:{id}`) and batch entries (`batch:{device}:{timestamp}`).
  - `buildSnapshotFromRedis`: Fetches recent batches, synthesizes sections (Threat Meter, Category Breakdown, Live Feed) even when MemoryStore is empty.
  - Caching: 5-minute snapshot cache per device, 12-second cache for `/api/devices`.
- **`MemoryStore`** (fallback):
  - In-process storage for HTTP-only mode.
  - Used when `USE_REDIS=false` or as secondary cache.

#### 3.3.3 Presentation

**Overview Page (`app/page.tsx`)**:
- Online device count, severity stats (critical/alert/warn/info)
- Live detection feed (recent batches)
- Search bar (nickname, ID, IP) with accessible labels
- Threat filter dropdown (all/critical/high/medium/low)

**Dashboard Page (`app/dashboard/page.tsx`)**:
- Threat meter (gauge chart, 0-100 risk)
- Category breakdown (bar chart: programs, network, behavior, auto, vm, screen)
- Historical trend charts (hourly/daily)
- System reports timeline

**Devices Page (`app/devices/page.tsx`)**:
- Searchable/filterable device table
- Columns: Nickname, Hostname, ID, IP, Status, Last Seen, Threat Level
- Click-through to player profile

**Player Profile (`app/players/[id]/page.tsx`)**:
- **Header**: Nickname (e.g., "FastCarsss"), Hostname (e.g., "JakobsDator"), Device ID
- **Stats**: Bot probability, total detections, session duration
- **Recent Batches**: Timeline of detection events
- **Threat Analysis**: Aggregated threats with severity breakdown
- **Export**: Download player report (JSON/CSV)

**Realtime Updates (`/api/stream`)**:
- SSE endpoint pushes snapshot diffs every few seconds
- UI subscribes, updates cards/feeds without polling

#### 3.3.4 Authentication & Security
- **NextAuth** credentials provider (`ADMIN_USER`, `ADMIN_PASS`)
- Sessions signed with `NEXTAUTH_SECRET`
- Protected routes require valid session
- Token-based API authentication (`SIGNAL_TOKEN`, `ADMIN_TOKEN`)

### 3.4 Key Features

1. **Dual Storage Support**: Seamlessly handles both HTTP and Redis ingestion modes
2. **Nickname + Hostname Display**: Shows player identity ("FastCarsss") and machine ("JakobsDator")
3. **Accessible UI**: Form inputs with proper labels, IDs, names (Lighthouse compliant)
4. **Realtime Updates**: SSE keeps dashboard live without constant polling
5. **Historical Analytics**: Hourly/daily aggregations for trend analysis
6. **Export Functionality**: JSON/CSV exports for compliance reporting
7. **Responsive Design**: Tailwind CSS, mobile-friendly layouts

### 3.5 Operational Considerations

- **Deployment**: Designed for Render/Vercel/Node hosting + Redis Cloud
- **Environment Variables**: Must mirror scanner's `config.txt` (Redis URL, tokens, ports)
- **Monitoring**: Dashboard should have uptime monitoring, error alerting
- **Scaling**: Redis handles thousands of concurrent devices; Next.js can scale horizontally
- **Backup**: Redis persistence (RDB/AOF) ensures data durability

---

## 4. Integration Contract

### 4.1 Batch Format

Both HTTP and Redis modes use identical JSON structure. Key fields:

```json
{
  "scan_type": "unified",
  "batch_number": 123,
  "bot_probability": 45,
  "nickname": "FastCarsss",
  "timestamp": 1700000000,
  "summary": {
    "critical": 2,
    "alert": 5,
    "warn": 8,
    "info": 12,
    "total_detections": 27,
    "total_threats": 15,
    "threat_score": 45
  },
  "categories": {
    "programs": 6,
    "network": 4,
    "behaviour": 3,
    "auto": 2,
    "vm": 0,
    "screen": 0
  },
  "aggregated_threats": [
    {
      "threat_id": "chrome.exe_12345",
      "severity": "ALERT",
      "source": "programs",
      "description": "Solver detected: chrome.exe",
      "threat_points": 15
    }
  ],
  "segments": { /* raw segment reports */ },
  "device": {
    "device_id": "abc123",
    "device_name": "JakobsDator",
    "hostname": "JakobsDator",
    "ip_address": "192.168.1.100",
    "os": "Windows 11",
    "cpu": "Intel i7-12700K",
    "ram": "32GB"
  },
  "metadata": {
    "config_version": "1.2.3",
    "batch_interval_seconds": 92,
    "session_id": "session_abc123"
  }
}
```

Full schema documented in `batch_logs/README_BATCH_STRUCTURE.md`.

### 4.2 Redis Schema

Shared between `core/redis_schema.py` (Python) and `site/.../lib/redis/schema.ts` (TypeScript).

**Keys**:
- `device:{id}` (hash): `player_nickname`, `player_nickname_confidence`, `device_hostname`, `device_name`, `ip_address`, `status`, `last_seen`, `first_seen`, `logged_out`
- `batch:{device}:{timestamp}` (string): Full batch JSON
- `batches_hourly` (sorted set): Recent batch keys by timestamp
- `recent_devices` (sorted set): Device IDs by last activity
- `device_categories:{device}` (sorted set): Category scores per device

**TTLs**:
- Device hashes: 7 days (configurable via `REDIS_TTL_SECONDS`)
- Batch entries: 7 days
- Sorted sets: Auto-trimmed to max size (e.g., 10k entries)

### 4.3 API Endpoints

| Endpoint | Method | Purpose | Auth |
| --- | --- | --- | --- |
| `/api/signal` | POST | Batch ingestion (HTTP mode) | `SIGNAL_TOKEN` |
| `/api/devices` | GET | Device list | Session |
| `/api/players` | GET | Player summaries | Session |
| `/api/snapshot` | GET | Snapshot data | Session |
| `/api/stream` | GET | SSE live feed | Session |
| `/api/history/hour` | GET | Hourly aggregations | Session |
| `/api/history/day` | GET | Daily aggregations | Session |
| `/api/configs` | GET | Config feed (optional) | `ADMIN_TOKEN` |

### 4.4 Nickname Propagation

- Scanner emits "Player Name Detected" signal early (OCR)
- Redis forwarder updates `player_nickname` in `device:{id}` hash
- Batch includes `nickname` field
- Dashboard reads nickname from device hash or batch, prioritizes hash
- UI displays: "Nickname: FastCarsss" + "Host: JakobsDator" + "ID: abc123"

---

## 5. Deployment & Infrastructure

### 5.1 Scanner Deployment

**Target**: Windows machines running CoinPoker client

**Packaging**:
1. Bundle `scanner.py` + dependencies with PyInstaller:
   ```bash
   pyinstaller --onefile --name coinpoker-scanner scanner.py
   ```
2. Sign `.exe` with code signing certificate (avoid Windows SmartScreen warnings)
3. Create Windows service installer (e.g., NSSM, sc.exe)
4. Configure auto-start, restart on failure
5. Set elevated privileges (admin/system account)

**Distribution**:
- Internal download portal for CoinPoker staff
- Automated deployment via GPO/SCCM (enterprise)
- Manual install instructions for smaller deployments

**Configuration**:
- Ship with default `config.txt` (DEV endpoints, test tokens)
- Production deploys receive encrypted config via secure channel
- Service reads config from `C:\ProgramData\CoinPoker\config.txt` or similar

### 5.2 Dashboard Deployment

**Hosting Options**:
- **Render** (recommended): Node.js hosting, auto-deploy from Git
- **Vercel**: Next.js-optimized, global CDN
- **AWS/Azure**: Full control, requires more DevOps

**Steps**:
1. Set environment variables (`.env.local` → hosting platform env vars):
   ```
   USE_REDIS=true
   REDIS_URL=redis://...
   SIGNAL_TOKEN=...
   ADMIN_TOKEN=...
   NEXTAUTH_SECRET=...
   NEXTAUTH_URL=https://...
   ADMIN_USER=admin
   ADMIN_PASS=...
   ```
2. Deploy Next.js app:
   ```bash
   cd site/bot-rta-dashboard
   npm install
   npm run build
   npm start  # or platform-specific deploy
   ```
3. Configure custom domain, SSL certificate
4. Set up monitoring (uptime checks, error tracking)

### 5.3 Redis Cloud

**Provider**: Redis Cloud (recommended for managed service)

**Configuration**:
- Plan: ~80 EUR/month (current tier, adjust based on load)
- Region: Choose closest to dashboard hosting
- Persistence: Enable RDB + AOF for durability
- Security: Password auth, TLS optional (not required for current setup)
- Connection string: `redis://default:password@host:port`

**Scaling**:
- Monitor memory usage, connections
- Upgrade tier if approaching limits (current setup handles 1000s of devices)
- Consider clustering for very high scale (10k+ devices)

### 5.4 Cost Summary

| Component | Monthly Cost (EUR) | Notes |
| --- | --- | --- |
| Redis Cloud | ~80 | Current tier, scales up as needed |
| Dashboard Hosting | 60-120 | Render/Vercel pro tier |
| OpenAI (optional) | <10 | Pay-per-use, minimal unless AI features active |
| **Total** | **~150-210 EUR** | Operational costs only |

Initial development investment: 480-640 engineering hours (see Section 6).

---

## 6. Engineering Effort & Valuation

### 6.1 Development Effort Estimate

Assuming an experienced 3-4 person team building from scratch:

| Workstream | Scope | Hours |
| --- | --- | --- |
| **Detection Tool** | Process/VM/program/network segments, OCR nickname detector, batch aggregator, Redis & HTTP forwarders, encrypted config loader, simulator | 230-300 |
| **Dashboard & APIs** | NextAuth, Redis/Memory storage adapters, snapshot/SSE feeds, device & player pages, charts, modals, exports, history endpoints | 190-250 |
| **QA & Testing** | Simulator-driven load tests, unit/integration tests, security audits | 40-60 |
| **DevOps & Packaging** | Windows service packaging, Redis setup, dashboard deployment, monitoring, documentation | 20-30 |
| **Total** |  | **480-640 hours** |

**Cost Range** (85-110 EUR/hour, reflecting AI-assisted coding trends):
- **41 000 - 70 000 EUR** replacement cost

### 6.2 Market Valuation

**Replacement Value**: Building an equivalent in-house solution would cost 41k-70k EUR and take 3-4 developer-months plus research/tuning time. Most poker operators lack dedicated anti-bot teams, making a turnkey solution attractive.

**Commercial Comparables**: Anti-cheat/RTA monitoring solutions for poker sites typically license for:
- **Upfront**: 100k-200k USD (one-time)
- **SaaS**: 3-5k EUR/month + onboarding fees

**This Platform's Value**:
- Production-ready (Redis Cloud, Render, SSE, simulator)
- Modular segments (easy to extend detection logic)
- Dual-mode ingestion (HTTP + Redis) for resilience
- Admin dashboard with real-time + historical views
- Nickname propagation ensures clear player identity
- Stress-tested simulator validates scale (2000+ players)

**Estimated Sale Price** (unbiased, assuming detection accuracy can be demonstrated):
- **Full acquisition**: **100k-200k USD** (≈95k-190k EUR)
- **Licensing**: **3-5k EUR/month** per operator + 10-20k onboarding

**Factors Affecting Value**:
- Proven detection accuracy (false positive/negative rates)
- Integration effort for other poker platforms (currently CoinPoker-specific)
- Support & maintenance commitments
- IP ownership and customization rights

### 6.3 AI Impact on Valuation

While AI lowers some coding costs, the unique value here is **domain expertise**:
- OCR tuning for CoinPoker UI
- Detection heuristics for poker-specific bots/RTAs
- Pipeline reliability and Redis schema design
- Operational hardening (encryption, service packaging)

Generic AI tooling cannot replicate these specialized elements quickly. Therefore, depreciation from "AI commoditization" is modest (<15%). Buyers will still pay a premium for a field-tested, turnkey stack.

---

## 7. Recommendations

### 7.1 For Engineering Teams

1. **Service Packaging**: Document Windows service install process (PyInstaller commands, NSSM/sc.exe config, privilege requirements). Provide uninstall script.
2. **Configuration Management**: Maintain parity table between `config.txt` and `.env.local`. Automate config sync or use shared source of truth.
3. **Monitoring & Alerting**: 
   - Scanner: Centralize logs (Syslog, ELK), alert on detection spikes or service crashes.
   - Dashboard: Uptime monitoring (UptimeRobot), error tracking (Sentry), Redis metrics (memory, connections).
4. **Testing**: 
   - Run simulator benchmarks routinely (e.g., 2000 players × 15 min).
   - Validate both HTTP and Redis ingestion paths.
   - Perform security audits (token rotation, encryption strength).
5. **Documentation**: 
   - Expand batch schema docs (`batch_logs/README_BATCH_STRUCTURE.md`).
   - Write runbooks for scanner deployment, Redis provisioning, dashboard redeploy, incident response.
   - Maintain CHANGELOG for version tracking.

### 7.2 For Business/Compliance

1. **Accuracy Metrics**: Measure and document detection accuracy:
   - True positive rate (bots correctly flagged)
   - False positive rate (legit players flagged)
   - Mean time to detection (MTTD)
2. **Privacy & GDPR**: 
   - Document what data is collected (nicknames, IPs, device IDs, processes).
   - Ensure compliance with player agreements, local regulations.
   - Implement data retention policies (7-day Redis TTL is a start).
3. **Pitch Materials**: 
   - Create demo environment (simulator-driven dashboard for prospects).
   - Prepare case studies showing detection examples (anonymized).
   - Price sheet: upfront vs. SaaS licensing options.
4. **Licensing**: 
   - Define IP ownership, customization rights, white-labeling terms.
   - Offer support tiers (basic email, premium 24/7, custom integration).

### 7.3 For Operations

1. **Capacity Planning**: 
   - Monitor Redis memory usage, scale tier before hitting limits.
   - Dashboard can scale horizontally (add Next.js instances behind load balancer).
2. **Backup & DR**: 
   - Enable Redis persistence (RDB + AOF), test restore procedures.
   - Backup dashboard config, database schemas, deployment scripts.
3. **Updates & Patching**: 
   - Scanner: Roll out new `.exe` versions via controlled deployment (pilot group → full fleet).
   - Dashboard: Use blue-green deployments to minimize downtime.
   - Coordinate config changes between scanner and dashboard.
4. **Incident Response**: 
   - Define escalation paths for detection spikes, service outages.
   - Prepare playbooks for common issues (Redis connection drops, OCR failures, token expiry).

---

## 8. Appendices

### 8.1 Glossary

| Term | Definition |
| --- | --- |
| **RTA** | Real-Time Assistance; external tools providing live poker advice |
| **Bot** | Automated script playing poker without human input |
| **OCR** | Optical Character Recognition; extracting text from images |
| **SSE** | Server-Sent Events; HTTP streaming for realtime updates |
| **TTL** | Time To Live; expiration time for cached/stored data |
| **Segment** | Modular detection component (programs, network, behavior, etc.) |
| **Batch** | Aggregated detection report sent every ~92 seconds |
| **Device Hash** | Redis hash storing device metadata (nickname, hostname, status) |
| **Threat Score** | Numeric risk indicator (0-100) based on aggregated threats |

### 8.2 Key Files Reference

| File | Purpose |
| --- | --- |
| `scanner.py` | Main detection runner |
| `simulator.py` | Load testing simulator |
| `config.txt` | Master configuration |
| `core/redis_forwarder.py` | Redis publishing logic |
| `core/web_forwarder.py` | HTTP batch posting |
| `utils/nickname_detector.py` | OCR nickname extraction |
| `site/.../lib/storage/redis-store.ts` | Dashboard Redis adapter |
| `site/.../app/api/signal/route.ts` | HTTP batch ingestion endpoint |
| `batch_logs/README_BATCH_STRUCTURE.md` | Batch schema documentation |

### 8.3 Environment Variables Matrix

| Variable | Scanner (config.txt) | Dashboard (.env.local) | Purpose |
| --- | --- | --- | --- |
| `ENV` | ✓ | - | DEV or PROD |
| `WEB_URL_DEV` / `WEB_URL_PROD` | ✓ | - | Dashboard URL for HTTP mode |
| `REDIS_URL` | ✓ | ✓ | Redis connection string |
| `SIGNAL_TOKEN` | ✓ | ✓ | API authentication |
| `ADMIN_TOKEN` | ✓ | ✓ | Admin API access |
| `USE_REDIS` | ✓ | ✓ | Enable Redis storage |
| `FORWARDER_MODE` | ✓ | - | `http` or `redis` |
| `BATCH_INTERVAL_HEAVY` | ✓ | - | Batch interval (seconds) |
| `NEXTAUTH_SECRET` | - | ✓ | Session signing key |
| `NEXTAUTH_URL` | - | ✓ | Dashboard URL |
| `ADMIN_USER` / `ADMIN_PASS` | - | ✓ | Dashboard credentials |

### 8.4 Support Contacts

- **Technical Issues**: [support@coinpoker.com](mailto:support@coinpoker.com)
- **Security/Compliance**: [security@coinpoker.com](mailto:security@coinpoker.com)
- **Commercial Inquiries**: [business@coinpoker.com](mailto:business@coinpoker.com)

---

## Conclusion

The CoinPoker Bot Detection Platform represents a comprehensive, production-grade solution for identifying and mitigating bot/RTA threats in poker environments. With a modular Python scanner designed for Windows service deployment and a feature-rich Next.js admin dashboard, the system provides real-time visibility, historical analytics, and operational resilience through dual HTTP/Redis ingestion modes.

**Key Strengths**:
- Modular, extensible architecture
- Production-ready deployment (Redis Cloud, Render, encrypted configs)
- Stress-tested simulator for validation
- Clear player identity (nickname + hostname propagation)
- Accessible, real-time UI with SSE updates

**Estimated Value**: 41k-70k EUR replacement cost, 100k-200k USD market value with proven accuracy.

**Next Steps**: Document service packaging, measure detection accuracy, prepare pitch materials, and expand to additional poker platforms.

---

**Document Version**: 1.0  
**Last Updated**: November 2025  
**Maintained By**: CoinPoker Engineering Team


