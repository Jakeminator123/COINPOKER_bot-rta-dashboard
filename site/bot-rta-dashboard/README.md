# BotRTA Dashboard (Next.js)

Webb-dashboard för CoinPoker bot/RTA-detektion. Tar emot **unified batch** var ~92s och visar spelare, historik och segment-fynd.

## Viktiga features

- **Player view** (realtid via SSE + snapshot)
- **Admin Settings**: segment-baserad config (Programs/Network/Behaviour/VM/Auto/Screen/Security + System)
- **SHA Database** (hashar för program-identifiering)
- **VirusTotal integration** (via server-side env, UI visar status + test)
- **Recordings** (screen recordings via command)

## Lokal utveckling

Kör i den här mappen:

```bash
npm install
npm run dev
```

### Miljövariabler (vanliga)

- `SIGNAL_TOKEN` – om `/api/signal` ska kräva Bearer-token
- `USE_REDIS=true` – använd RedisStore istället för MemoryStore
- `REDIS_URL=redis://...`
- `REDIS_TTL_SECONDS=604800` (default 7 dagar)
- `VIRUSTOTAL_API_KEY=...` (för VT lookups)

## Redis

Canonical keys finns i `lib/redis/schema.ts`.

Notera att det även finns device commands via Redis (`/api/device-commands/redis`) som använder:
- `device:<id>:command_queue` (ZSET)
- `device:<id>:commands:<cmdId>` (JSON)
- `device:<id>:command_result:<cmdId>` (JSON)

## Recordings storage (deploy)

Recordings skrivs lokalt som default. I hosting (t.ex. Render) är det vanligt att använda en persistent disk eller cloud bucket.

- **Render Disk**: sätt `RECORDINGS_DIR=/opt/render/project/src/recordings`
- **Cloud storage**: konfigurera S3/R2 via env (om/om när backend-stödet används)

## Importera V0 templates/components (Vercel v0)

V0 kan exportera shadcn/ui-komponenter direkt till codebase.

1) Se till att `shadcn/ui` är initierat i projektet (en gång).
2) Kör “Add to Codebase”-kommandot från V0 i den här mappen, t.ex.:

```bash
npx shadcn@latest add "<V0_URL>"
```

Sedan importerar du komponenten i din sida/komponent (v0 lägger vanligtvis filer under `components/ui/*` och/eller `components/*`).

Praktiska tips:
- Kör kommandot från **`site/bot-rta-dashboard/`** (inte repo-roten).
- Om v0 ger en hel “section/page”, kopiera in den i lämplig `app/*` route och justera imports till `@/…`.


