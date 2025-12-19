# Bot & RTA Detection Dashboard - Överlämningsdokumentation

## Projektöversikt

Webb-dashboard för CoinPoker bot/RTA-detektion. Tar emot batch-rapporter från agenten (~92s intervall) och visar spelare, historik och detektioner i realtid.

**Tech Stack:**
- Next.js 16.0.0 (App Router)
- React 19.2.0
- TypeScript 5
- Tailwind CSS 3.4
- Redis (för persistent lagring)
- NextAuth.js (autentisering)

---

## Mappstruktur

```
bot-rta-dashboard/
├── app/                      # Next.js App Router
│   ├── api/                  # API endpoints
│   │   ├── analyze/          # AI-analys av spelare
│   │   ├── configs/          # Konfigurationshantering
│   │   ├── device-commands/  # Kommandon till agenten
│   │   ├── devices/          # Enhetslista
│   │   ├── history/          # Historikdata
│   │   ├── players/          # Spelarlista med detected_categories
│   │   ├── recordings/       # Skärminspelningar
│   │   ├── signal/           # Ingest för signaler
│   │   ├── snapshot/         # Realtidsdata (SSE)
│   │   └── ...
│   ├── dashboard/            # Individuell spelarvy
│   ├── login/                # Inloggningssida
│   ├── settings/             # Admin-inställningar
│   └── page.tsx              # Huvudsida (översikt)
├── components/               # React-komponenter
│   ├── config-editors/       # Konfigurationsredigerare
│   ├── charts/               # Diagramkomponenter
│   └── ...
├── configs/                  # JSON-konfigurationsfiler
│   ├── default_values/       # Standardvärden
│   ├── programs_config.json
│   ├── network_config.json
│   ├── behaviour_config.json
│   ├── vm_config.json
│   ├── auto_config.json
│   └── ...
├── lib/                      # Affärslogik
│   ├── detections/           # Detektionslogik
│   ├── device/               # Enhetshantering
│   ├── redis/                # Redis-schema och helpers
│   ├── storage/              # Storage adapters (Redis/Memory)
│   └── utils/                # Hjälpfunktioner
├── public/                   # Statiska filer
└── scripts/                  # Hjälpscript
```

---

## Detektionskategorier

Systemet använder **5 huvudkategorier** för att klassificera detektioner:

| Kategori | ID | Beskrivning |
|----------|-----|-------------|
| Programs | `programs` | Förbjudna program (bots, RTA-verktyg) |
| Network | `network` | Nätverksrelaterade detektioner (VPN, proxy, misstänkt DNS) |
| Behaviour | `behaviour` | Beteendeanalys (klickmönster, timing) |
| VM | `vm` | Virtuella maskiner (VMware, VirtualBox, Hyper-V) |
| Automation | `auto` | Automatiseringsverktyg (AutoHotkey, scripts) |

### Kategori-flöde

1. **Agent** → Skickar batch-rapport till `/api/signal` eller `/api/snapshots/batch`
2. **Redis** → Lagrar kategoridata i `device:${deviceId}:categories`
3. **API** → `/api/devices` returnerar `detected_categories[]` för varje spelare
4. **Frontend** → Visar segmentknappar (Programs, Network, etc.) med antal spelare

### Redis-nycklar för kategorier

```
device:${deviceId}:categories = {
  "updatedAt": 1734567890000,
  "severityHighest": "critical",
  "totalFindings": 5,
  "segmentsRan": ["programs", "network", "behaviour"],
  "segments": [
    { "name": "programs", "totalFindings": 3, "hasFindings": true },
    { "name": "network", "totalFindings": 2, "hasFindings": true }
  ]
}
```

---

## Miljövariabler

Skapa `.env.local` med följande:

```bash
# Autentisering
NEXTAUTH_SECRET=din-hemliga-nyckel-här
NEXTAUTH_URL=http://localhost:3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=ditt-lösenord

# Redis (om USE_REDIS=true)
USE_REDIS=true
REDIS_URL=redis://localhost:6379
REDIS_TTL_SECONDS=604800  # 7 dagar

# VirusTotal (valfritt)
VIRUSTOTAL_API_KEY=din-api-nyckel

# Signal-autentisering (valfritt)
SIGNAL_TOKEN=din-bearer-token

# Google Maps (valfritt, för IP-geolokalisering)
GOOGLE_MAPS_API_KEY=din-api-nyckel
```

---

## Kommandon

```bash
# Installera dependencies
npm install --legacy-peer-deps

# Starta utvecklingsserver
npm run dev

# Bygg för produktion
npm run build

# Starta produktionsserver
npm start

# Lint
npm run lint
```

---

## API-endpoints

### Huvudendpoints

| Endpoint | Metod | Beskrivning |
|----------|-------|-------------|
| `/api/devices` | GET | Lista alla enheter med `detected_categories` |
| `/api/players` | GET | Lista spelare med detaljerad info |
| `/api/snapshot` | GET | Realtidsdata för en spelare |
| `/api/signal` | POST | Ta emot signaler från agenten |
| `/api/configs` | GET/POST | Läs/skriv konfiguration |

### Device Commands

| Endpoint | Beskrivning |
|----------|-------------|
| `/api/device-commands/queue` | Köa kommando till agent |
| `/api/device-commands/result/[id]` | Hämta kommandoresultat |
| `/api/recordings` | Lista/hantera skärminspelningar |

---

## Redis-schema

Alla Redis-nycklar definieras i `lib/redis/schema.ts`:

```typescript
device:${deviceId}              // Hash med enhetsinfo
device:${deviceId}:threat       // Threat level (number)
device:${deviceId}:categories   // Kategorisammanfattning (JSON)
device:${deviceId}:detections:CRITICAL  // Antal kritiska detektioner
device:${deviceId}:detections:WARN      // Antal varningar
device:${deviceId}:command_queue        // Kommandokö (ZSET)
top_players                     // Sorterad lista av spelare (ZSET)
```

---

## Frontend-funktioner

### Huvudsida (`/`)
- **Segment-filter**: Filtrera spelare efter kategori (Programs, Network, etc.)
- **Threat-filter**: Filtrera efter risknivå (Critical, High, Medium, Low)
- **View modes**: Normal (20 spelare/sida) eller Compact (60 spelare/sida)
- **Dark mode**: Standard, kan växlas till light mode

### Dashboard (`/dashboard?player=ID`)
- Detaljerad vy för enskild spelare
- Realtidsuppdateringar via SSE
- Historikdiagram
- AI-analys
- Skärminspelning

### Settings (`/settings`)
- Redigera detektionskonfiguration
- SHA-databas för programidentifiering
- VirusTotal-integration

---

## Viktiga komponenter

| Komponent | Fil | Beskrivning |
|-----------|-----|-------------|
| DeviceListModule | `components/DeviceListModule.tsx` | Spelarlista med filter och pagination |
| CustomSelect | `components/CustomSelect.tsx` | Dropdown med portal (z-index fix) |
| DarkModeContext | `lib/DarkModeContext.tsx` | Dark mode state management |
| SpinningLogo3D | `components/SpinningLogo3D.tsx` | 3D-logga (Three.js) |

---

## Kända begränsningar

1. **Segmentering kräver kategoridata**: För att Programs/Network/etc. ska visa spelare måste agenten skicka `categories`-data i batch-rapporter.

2. **React 19 kompatibilitet**: Vissa paket har peer dependency-varningar för React 19.

3. **Redis krävs för produktion**: MemoryStore fungerar för utveckling men data försvinner vid omstart.

---

## Deployment

### Render.com
```bash
# Build command
npm install --legacy-peer-deps && npm run build

# Start command
npm start

# Environment
NODE_ENV=production
USE_REDIS=true
REDIS_URL=redis://...
```

### Vercel
```bash
# Automatisk deployment via Git
# Lägg till miljövariabler i Vercel Dashboard
```

---

## Felsökning

### "No devices found" vid segmentfiltrering
- **Orsak**: Agenten skickar inte `categories`-data
- **Lösning**: Se till att batch-rapporter inkluderar `segments` med `totalFindings > 0`

### Dropdown går under kort
- **Fixat**: CustomSelect använder React Portal med z-index 99999

### Dark mode återställs
- **Fixat**: Dark mode är nu default och sparas i localStorage

---

## Kontakt & Support

Detta projekt utvecklades för CoinPoker's bot/RTA-detektionssystem.

**Senast uppdaterad**: December 2024

