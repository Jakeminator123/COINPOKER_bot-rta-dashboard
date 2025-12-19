# CoinPoker Bot & RTA Detection (Detector + Dashboard)

Det här repot innehåller två huvuddelar:

- **Scanner (Python)**: körs på spelarens maskin och samlar signaler från segmenten (`segments/*`).
- **Dashboard (Next.js)**: web-app för att se spelare, historik och konfigurera regler (`site/bot-rta-dashboard`).

## Arkitektur (kort)

### Segment (scanner)
Segmenten ligger i `segments/` och speglar de 7 kategorierna:
- `programs` (processer, hash/signatur, obfuskering)
- `network` (webb/DNS/traffic)
- `behaviour` (mus/tangentbord/click-mönster)
- `vm` (virtualisering)
- `auto` (automation/makro/script)
- `screen` (overlays/HUD/window analysis)
- `security` (MITM/certifikat)

### Batch-flöde (92s)
Scannern deduplicerar och skickar en **unified batch** ungefär var 92:e sekund:
- via HTTP: `POST /api/signal` (dashboard)
- eller direkt till Redis via `core/redis_forwarder.py` (om Redis-forwarding används)

Batchen innehåller bl.a.:
- `bot_probability` (0–100) **primär score** (frontend ska inte räkna om)
- `aggregated_threats` (deduplicerad “sanning” för threats)
- `system.os_platform/os_release/os_version/os_arch` (OS/plattform)

## Redis (schema & nycklar)

**Canonical schema** ligger i:
- `site/bot-rta-dashboard/lib/redis/schema.ts` (dashboard)
- `core/redis_schema.py` (scanner)

Vanliga keys (översikt):
- `device:<id>` (HASH) – device- och spelar-identifiers (nickname/email), last_seen, threat_level, OS-fält
- `device:<id>:threat` (STRING) – senaste threat score
- `device:<id>:detections:<SEVERITY>` (STRING) – counters
- `device:<id>:categories` (STRING JSON) – senaste segment-snapshot
- `batch:<id>:<ts>` (STRING JSON) – batch record
- `batches:<id>:hourly|daily` (ZSET) – index
- `day:<id>:YYYY-MM-DD` / `hour:<id>:YYYY-MM-DDTHH` (HASH) – aggregat
- `player_summary:<id>` (STRING JSON) – rullande snitt och totals
- `sessions:<id>` (ZSET) + `session:<id>:<ts>` (STRING JSON) – session-historik
- `updates:<id>` / `updates:all` (PUBSUB) – realtidsuppdateringar
- (valfritt) commands via Redis:
  - `device:<id>:command_queue` (ZSET)
  - `device:<id>:commands:<cmdId>` (STRING JSON)
  - `device:<id>:command_result:<cmdId>` (STRING JSON)

## Konfiguration

Dashboarden hostar configs som scanner laddar via `utils/config_loader.py`:
- `site/bot-rta-dashboard/configs/*.json` (och `configs/default_values/*`)

## Viktiga notes (senaste ändringar)

- **Simplified Configuration** är borttagen helt (endast Advanced kvar).
- **Kill/auto-kill** är borttagen helt (UI/API/scanner/segment/script).
- **OS (Windows/macOS/Linux)** plockas från batch `system.*` och kan visas per spelare.

## Kör lokalt (översikt)

Dashboard: se `site/bot-rta-dashboard/README.md`.

Scanner (exempel):
- `scanner.py` startar scannern
- `FORWARDER_MODE=web|redis|auto` styr om batch går via HTTP eller Redis


