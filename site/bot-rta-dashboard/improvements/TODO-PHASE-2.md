# 🎯 FAS 2 - Viktiga förbättringar (3-4 timmar)

## Mörkt läge (1 timme)
- [ ] Lägg till dark mode toggle i header
- [ ] Spara tema-val i localStorage
- [ ] Använd Tailwind dark: prefix för alla komponenter
- [ ] Testa kontraster i båda lägen

## Data Export (1 timme)
- [ ] Export till CSV för device lista
- [ ] Export detections till JSON
- [ ] Lägg till "Export" knapp i UI
- [ ] Begränsa export till max 1000 rader

## Bättre felhantering (1 timme)
- [ ] Global error handler för alla API routes
- [ ] User-friendly felmeddelanden (inte stack traces)
- [ ] Retry-logik för Redis-anslutningar
- [ ] Logga fel till fil (inte console)

## Prestanda-optimering (1 timme)
- [ ] Implementera virtuell scrollning för långa listor
- [ ] Debounce search/filter inputs
- [ ] Memoize tunga beräkningar
- [ ] Code splitting för stora komponenter

## Varför dessa?
- **Mörkt läge:** 40% av användare föredrar det, minskar ögontrötthet
- **Export:** Kritisk för rapportering och analys
- **Felhantering:** Professionellt intryck, enklare debugging
- **Prestanda:** Skalbar för 1000+ devices
