# 💫 NICE TO HAVE - Om tid finns (Lägre prioritet)

## Avancerad visualisering
- [ ] Heatmap för aktivitet per timme
- [ ] Geografisk karta över device locations (IP-baserat)
- [ ] Trendlinjer i grafer
- [ ] Animerade övergångar

## Realtidsuppdateringar
- [ ] WebSocket för live updates
- [ ] "X users online" indikator
- [ ] Live activity feed
- [ ] Auto-refresh var 30:e sekund (som fallback)

## Användarinställningar
- [ ] Anpassningsbar dashboard layout
- [ ] Spara filter-preferenser
- [ ] Tidszons-val
- [ ] Språkstöd (en/sv)

## Avancerad sökning
- [ ] Sök efter nickname med fuzzy matching
- [ ] Datum-range picker
- [ ] Kombinerade filter (AND/OR)
- [ ] Sparade sökningar

## 🚫 SKIPPA DESSA (från original-listan):
- **PWA funktionalitet** - Overkill för intern dashboard
- **Push notifikationer** - E-post räcker
- **Användarroller** - Bara du använder systemet
- **SQL-injection skydd** - Använder inte SQL
- **2FA** - Overkill för detta projekt
- **PDF export** - CSV räcker
- **Offline-stöd** - Behöver alltid Redis-data ändå

## Varför skippa?
- **Komplexitet > Värde** för detta specifika projekt
- **Underhållsbörda** blir för stor
- **YAGNI** (You Ain't Gonna Need It) - principen
