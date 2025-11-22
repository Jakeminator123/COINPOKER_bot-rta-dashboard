# Redis Monitor Script

Ett script som monitorar och loggar alla Redis-operationer i realtid. Perfekt för att se exakt vad som sparas till Redis när scanner.py och dashboard körs.

## Installation

Först, installera dotenv om det inte redan finns:

```bash
npm install --save-dev dotenv
```

## Användning

### Grundläggande användning

Kör scriptet direkt:

```bash
node scripts/redis-monitor.js
```

Eller använd npm scriptet:

```bash
npm run redis:monitor
```

### Alternativ

**Spara till fil:**
```bash
node scripts/redis-monitor.js --output redis-log.txt
```

**Filtrera på specifikt kommando (t.ex. bara SET):**
```bash
node scripts/redis-monitor.js --filter SET
```

**Kör i 10 sekunder och visa statistik:**
```bash
node scripts/redis-monitor.js --stats
```

**Kombinera:**
```bash
node scripts/redis-monitor.js --filter HSET --output redis-hset-log.txt
```

## Vad scriptet visar

Scriptet visar:
- **SET** - När JSON-data sparas (t.ex. player_summary)
- **HSET** - När hash-data sparas (t.ex. device info, aggregates)
- **HINCRBY** - När värden inkrementeras (t.ex. counters)
- **ZADD** - När data läggs till i sorted sets (t.ex. indexes, leaderboards)
- **SADD** - När data läggs till i sets (t.ex. segment indexes)
- **EXPIRE** - När TTL sätts på keys
- **MULTI/EXEC** - När transaktioner körs

## Färgkodning

- 🔵 **Cyan** - Device keys (`device:*`)
- 🟢 **Grön** - Player summaries (`player_summary:*`)
- 🟡 **Gul** - Historical aggregates (`hist:*`, `agg:*`, `hourly:*`, `minute:*`)
- 🟣 **Magenta** - Segment data (`segment:*`, `segments:*`)
- 🔵 **Blå** - Session data (`session:*`)
- ⚪ **Ljus** - Leaderboards (`leaderboard:*`)

## Exempel output

```
[2025-01-15T10:30:45.123Z] HSET device:462a6a3a5c173a1ea54e05b355ea1790 [12 fields]
  device_id = 462a6a3a5c173a1ea54e05b355ea1790
  device_name = MyDevice
  last_seen = 1705315845123
  signal_count = 1234
  ... 9 more fields

[2025-01-15T10:30:45.456Z] SET player_summary:462a6a3a5c173a1ea54e05b355ea1790 = {"device_id":"462a6a3a5c173a1ea54e05b355ea1790","avg_score":57.3,...}

[2025-01-15T10:30:45.789Z] ZADD minute_index:462a6a3a5c173a1ea54e05b355ea1790 [score: 1705315845, value: 202501151030]
```

## Statistik

När du stoppar scriptet (Ctrl+C) visas:
- Totalt antal kommandon
- Antal unika keys
- Fördelning av kommandon
- Key patterns och antal keys per pattern

## Konfiguration

Scriptet läser Redis-URL från `.env.local` eller `.env`:

```env
REDIS_URL=redis://localhost:6379
```

Om ingen REDIS_URL finns, används `redis://localhost:6379` som standard.

## Tips

1. **Starta scriptet först** innan du startar scanner.py och npm run dev
2. **Använd --output** för att spara loggar för senare analys
3. **Använd --filter** för att fokusera på specifika operationer
4. **Kör --stats** för att snabbt se vad som händer

## Felsökning

**"Failed to connect"**
- Kontrollera att Redis körs: `redis-cli ping`
- Kontrollera REDIS_URL i .env.local

**"Cannot find module 'dotenv'"**
- Kör: `npm install --save-dev dotenv`

**Ingen output**
- Kontrollera att scanner.py faktiskt skickar data
- Kontrollera att dashboard faktiskt sparar till Redis (USE_REDIS=true)

