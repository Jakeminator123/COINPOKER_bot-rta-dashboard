# Batch System Documentation

## Översikt

BotRTA Dashboard tar emot batch-rapporter från scanner-skripten varje 92:e sekund. Dessa batchar innehåller alla detektioner från de senaste 92 sekunderna och är redan deduplicerade och beräknade av backend-scannern.

## Dataflöde

### 1. Signal Mottagning (`/api/signal`)

**Endpoint:** `POST /api/signal`

**Funktion:**
- Tar emot batch-rapporter från scanner-skripten (7 mappar med totalt 12-13 skript)
- Stöder både enstaka signaler och batch-arrays
- Validerar autentisering (Bearer token om `SIGNAL_TOKEN` är satt)
- Rate limiting: max 100 requests per minut per IP

**Batch-identifiering:**
- Batch-rapporter identifieras som: `category === "system" && name.includes("Scan Report")`
- Batch-rapporter är alltid processade (ingen throttling)
- Andra signaler throttlas till max 1 per 3 sekunder per device

**Data-struktur:**
```typescript
{
  device_id: string,        // MD5 hash av device identifier
  device_name: string,     // Datornamn eller hostname
  device_ip: string,       // IP-adress
  category: "system",
  name: "Scan Report",
  details: string,         // JSON-sträng med batch-data
  timestamp: number
}
```

### 2. Batch-data Struktur

Batch-data (`details` fältet) innehåller:

```typescript
{
  bot_probability: number,        // 0-100, redan deduplicerad av backend
  aggregated_threats?: Array<{    // Primär källa för threats
    name: string,                 // t.ex. "weatherzeroservice.exe"
    category: string,             // "programs", "network", etc.
    status: string,               // "CRITICAL", "ALERT", "WARN"
    score: number,                // Deduplicerad poäng
    sources: string[],            // Alla detektionskällor som bekräftar detta
    detections: number,           // Antal detektioner som slogs ihop
    confidence: number            // Antal segment som bekräftar
  }>,
  summary?: {
    critical: number,
    alert: number,
    warn: number,
    info: number,
    total_detections?: number,
    raw_detection_score?: number,
    severityHighest?: string,
    segmentsRan?: string[]
  },
  segments?: Array<{
    name: string,                 // Segmentnamn (t.ex. "programs", "network")
    findings?: Array<{
      id?: string,
      severity?: string,
      title?: string,
      details?: Record<string, unknown>
    }>
  }>,
  nickname?: string,              // Spelarnamn (om detekterat)
  device?: {
    hostname?: string,
    agentVersion?: string
  },
  system?: {
    host?: string                 // Datornamn
  }
}
```

### 3. Redis Storage (`RedisStore`)

**Huvudfunktioner:**

#### `addSignal(sig: Signal)`
- Identifierar batch-rapporter vs. vanliga signaler
- Batch-rapporter: Processas i Redis för persistens
- Vanliga signaler: Går till MemoryStore för live feed

#### `storeBatchReport(device_id, batch, timestamp)`
Sparar batch-rapporten i Redis med flera nycklar:

1. **Batch Record:** `batch:${device_id}:${timestamp}`
   - Full batch-data med TTL (default 7 dagar)
   
2. **Device Hash:** `device:${device_id}`
   - `device_id`, `device_name`, `last_seen`, `threat_level`, `session_start`, `ip_address`
   - Uppdateras varje gång batch kommer in
   
3. **Device Threat:** `device:${device_id}:threat`
   - Snabb access till `threat_level` (bot_probability)
   
4. **Device Detections:** `device:${device_id}:detections:${severity}`
   - Antal detektioner per severity (CRITICAL, ALERT, WARN)
   
5. **Device Categories:** `device:${device_id}:categories`
   - Sammanfattning per segment med findings
   
6. **Time Indexes:**
   - `batches:${device_id}:hourly` - Sorted set med timestamps
   - `batches:${device_id}:daily` - Sorted set med timestamps
   - `hour:${device_id}:${hour}` - Statistik per timme
   - `day:${device_id}:${day}` - Statistik per dag

#### `updateDevice(device_id, device_name, threat_level, device_ip)`
- Uppdaterar device-hash i Redis
- Uppdaterar `last_seen` (kritisk för online-status)
- Hanterar session management (ny session om device varit offline >120s)
- Uppdaterar `top_players` sorted set för sortering

#### `updatePlayerSummary(device_id, bot_probability, timestamp)`
- Beräknar rullande medelvärde från senaste 24 timmarna
- Sparar i `player_summary:${device_id}`
- Innehåller: `avg_bot_probability`, `total_reports`, `total_detections`, `total_sessions`

#### `checkSessionEvents(device_id, device_name, timestamp, threat_level, batch)`
- Identifierar login/logout events baserat på:
  - Explicit logout: `scan_type === "logout"` eller `bot_probability === -1`
  - Timeout: Ingen batch på >120 sekunder
- Sparar session events i `session:${device_id}:${timestamp}`

### 4. Memory Store (`MemoryStore`)

**Användning:**
- Live detection feed för individuella player dashboards
- Real-time signaler (inte batch-rapporter)
- Throttling: Max 1 signal per 30 sekunder per unique detection
- TTL: 10 minuter (konfigurerbart via `MEMORY_STORE_TTL_MS`)

**Fallback Threat Scoring:**
- Används ENDAST när Redis inte är tillgänglig eller batch-rapporter saknas
- Enkel räkning: `critical * 15 + alert * 10 + warn * 5`
- **VIKTIGT:** Frontend ska ALDRIG använda detta när `bot_probability` finns tillgänglig

### 5. Device Name Resolution

**Prioritetsordning** (konfigurerbar via `config/redis_identity.json`):

1. `batch.system.host` - Datornamn (t.ex. "JakobsDator")
2. `batch.device` - Device name från batch
3. `batch.device.hostname` - Hostname från batch
4. `signal.device_name` - Device name från signal
5. `batch.meta.hostname` - Metadata hostname
6. `batch.nickname` - Spelarnamn (LÅG prioritet - används för nickname-fält)
7. `device_id` - MD5 hash fallback

**Sanitization:**
- `sanitizeDeviceName()` filtrerar bort:
  - Namn som är identiska med device_id
  - Namn som ser ut som hash-värden
  - Ogiltiga tecken

### 6. Threat Scoring

**Primär källa: `bot_probability`**
- Beräknas av backend-scannern
- Redan deduplicerad (t.ex. OpenHoldem från 3 källor = 1 threat)
- 0-100 skala
- Uppdateras varje 92:e sekund med batch-rapporten

**Prioritetsordning för frontend:**

1. `player_summary.avg_bot_probability` - Rullande medelvärde (24h)
2. `device:${deviceId}:threat` - Senaste batch `bot_probability`
3. `device:${deviceId}.threat_level` - Fallback från device hash
4. `top_players` sorted set score - Sista fallback

**VIKTIGT:**
- Frontend ska ALDRIG räkna om scores från detection counts
- Backend har redan gjort intelligent deduplicering
- Fallback-scoring är endast för när batch-rapporter saknas

### 7. Detektionslogik

**Segment-struktur:**
- 7 huvudsegment: `programs`, `network`, `behaviour`, `vm`, `auto`, `screen`, `security`
- Varje segment körs varje 92:e sekund
- Findings samlas ihop och dedupliceras av backend

**Threat Aggregation:**
- `aggregated_threats` är primär källa
- Visar vilka källor som bekräftat varje threat
- `confidence` = antal segment som bekräftar threat
- `detections` = antal individuella detektioner som slogs ihop

**Status-nivåer:**
- `CRITICAL` (15 poäng) - Högsta risk
- `ALERT` (10 poäng) - Medelhög risk
- `WARN` (5 poäng) - Låg risk
- `INFO` (0 poäng) - Informativ

### 8. Performance Optimizations

**Redis Pipeline:**
- `/api/players` använder pipeline för batch-fetching
- 7 Redis-kommandon per player körs i en batch
- Dramatiskt reducerad latency för stora player-listor

**Caching:**
- Device snapshots cachas för top 20 devices
- Devices list cachas för snabbare homepage-laddning
- Cache invalideras när nya batchar kommer in

**Throttling:**
- Batch-rapporter: Ingen throttling (alltid processade)
- Vanliga signaler: Max 1 per 3 sekunder per device
- MemoryStore: Max 1 per 30 sekunder per unique detection

### 9. Error Handling

**Redis Connection:**
- Automatisk fallback till MemoryStore om Redis inte är tillgänglig
- Lazy connection (ansluter endast när behövs)
- Build-time skip (ingen Redis-anslutning under build)

**Batch Parsing:**
- Felaktig JSON ignoreras (loggas som error)
- Saknade fält får default-värden
- Processing fortsätter även vid fel

**Device Updates:**
- Fel vid Redis-write loggas men kastar inte exception
- Verification av Redis-writes (endast i debug mode)
- Retry-logik för kritiska operationer

### 10. Konfiguration

**Environment Variables:**

- `USE_REDIS=true` - Aktivera Redis storage
- `REDIS_URL` - Redis connection string
- `REDIS_TTL_SECONDS` - TTL för Redis-nycklar (default: 604800 = 7 dagar)
- `SIGNAL_TOKEN` - Bearer token för `/api/signal` autentisering
- `DEBUG=true` - Aktivera debug logging
- `DEBUG_REDIS=true` - Aktivera Redis-specifik debug logging
- `MEMORY_STORE_TTL_MS` - TTL för MemoryStore (default: 600000 = 10 min)
- `SIGNAL_COOLDOWN_MS` - Cooldown för duplicate signals (default: 30000 = 30s)
- `MAX_DEVICES_IN_MEMORY` - Max devices i MemoryStore (default: 100)

**Config Files:**

- `config/redis_identity.json` - Device name prioritetsordning
- `configs/*.json` - Segment-konfigurationer

## Sammanfattning

1. **Batch-rapporter** kommer varje 92:e sekund från scanner-skripten
2. **Redis** används för persistens och historik
3. **MemoryStore** används för live feed och fallback
4. **bot_probability** är primär threat score (redan deduplicerad)
5. **Device names** resolvas med tydlig prioritetsordning
6. **Session management** hanterar login/logout automatiskt
7. **Performance** optimeras med pipelines och caching
8. **Error handling** är robust med fallbacks

Systemet är designat för att vara robust, skalbart och lätt att underhålla.

