# Batch JSON Structure

Detta dokument förklarar strukturen på batch-rapporter som genereras av detection tool.

## När batches genereras

Batches genereras automatiskt var 92:e sekund (eller enligt `BATCH_INTERVAL_HEAVY` i config.txt) när:
- CoinPoker är igång
- Scanner är aktiv

## Var batches sparas

Om `NEW_BATCHES_LOG=y` i config.txt sparas batches i `batch_logs/` mappen med format:
- `batch_YYYYMMDD_HHMMSS_N.json` där N är batch-numret

## Batch-struktur

### Huvudfält

- `scan_type`: "unified" (alltid)
- `batch_number`: Sekventiellt nummer (1, 2, 3...)
- `bot_probability`: Bot-sannolikhet 0-100 (från ThreatManager)
- `nickname`: Spelarnamn om det detekterats
- `timestamp`: Unix timestamp när batchen skapades

### Summary

- `critical`: Antal CRITICAL detections
- `alert`: Antal ALERT detections
- `warn`: Antal WARN detections
- `info`: Antal INFO detections
- `total_detections`: Totalt antal detections (pre-deduplication)
- `total_threats`: Antal unika threats (post-deduplication)
- `threat_score`: Bot probability (samma som bot_probability)
- `raw_detection_score`: Summa av alla threat points (pre-deduplication)

### Categories

Antal detections per kategori:
- `programs`: ProcessScanner detections
- `network`: WebMonitor/TrafficMonitor detections
- `behaviour`: BehaviourDetector detections
- `auto`: AutomationDetector detections
- `vm`: VMDetector detections
- `screen`: ScreenDetector detections

### Aggregated Threats

Lista över unika threats (deduplicerade):
- `threat_id`: Unik identifierare (t.ex. process ID)
- `name`: Threat namn
- `category`: Threat kategori
- `status`: CRITICAL/ALERT/WARN/INFO
- `score`: Threat score (points)
- `sources`: Vilka segments som detekterat detta
- `detections`: Antal gånger detta detekterats
- `confidence`: Confidence score 0-1
- `first_detected`: Timestamp när det först detekterades
- `details`: Detaljerad information

### System Info

- `cpu_percent`: CPU-användning %
- `mem_used_percent`: Minne-användning %
- `segments_running`: Antal aktiva segments
- `env`: ENV från config (DEV/PROD)
- `host`: Datornamn

### Metadata (om TESTING_JSON=y)

- `flow`: Förklaring av systemflödet
- `segments`: Lista över aktiva segments med intervall
- `timing`: Timing-information (batch interval, sync status)
- `configuration`: Konfiguration (ENV, web_enabled, testing_json)
- `system_state`: Systemtillstånd

## Hur Redis lagrar detta

När batches skickas till Redis (via RedisForwarder eller HTTP API) lagras de som:

### Batch Record (JSON)
```
Key: batch:{device_id}:{timestamp}
Value: {
  timestamp,
  bot_probability,
  raw_detection_score,
  critical, alert, warn, info,
  threats (count),
  categories,
  aggregated_threats,
  summary,
  segments,
  meta (metadata om TESTING_JSON=y)
}
TTL: 7 dagar (604800 sekunder)
```

### Device Info (Hash)
```
Key: device:{device_id}
Fields: {
  device_id,
  device_name,
  last_seen (timestamp),
  threat_level (bot_probability),
  session_start
}
TTL: 7 dagar
```

### Time Indexes (Sorted Sets)
```
batches:{device_id}:hourly - Batch keys sorterade per timme
batches:{device_id}:daily - Batch keys sorterade per dag
```

### Detection Counts
```
device:{device_id}:detections:CRITICAL - Antal critical
device:{device_id}:detections:WARN - Antal warn
device:{device_id}:detections:ALERT - Antal alert
```

## För att generera batches

1. Starta CoinPoker
2. Kör `python scanner.py`
3. Vänta 92 sekunder (eller tills första batch genereras)
4. Kolla `batch_logs/` mappen för JSON-filer

## Exempel

Se `example_batch_structure.json` för ett komplett exempel på en batch.

