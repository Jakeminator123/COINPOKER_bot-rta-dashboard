# 🌳 Git Branching Strategy

## Branch Struktur

```
main
├── feature/quick-wins          (Fas 1 - Performance & Säkerhet)
├── feature/dark-mode-export    (Fas 2 - UX förbättringar)
└── feature/advanced-viz        (Fas 3 - Nice to have)
```

## 🚀 Fas 1: Quick Wins Branch

### Skapa och starta:
```bash
# Skapa ny branch från main
git checkout main
git pull
git checkout -b feature/quick-wins

# Börja implementera
# ... gör ändringar ...

# Commit efter varje färdig del
git add .
git commit -m "feat: Add lazy loading to images"
git commit -m "security: Add rate limiting to API"
git commit -m "perf: Enable gzip compression"
```

### Medan du vilar kan AI fortsätta:
```bash
# AI kan jobba i samma branch
# Commit-meddelanden:
# - "feat:" för nya features
# - "fix:" för bugfixar
# - "perf:" för performance
# - "security:" för säkerhet
# - "docs:" för dokumentation
```

### När klar - merge till main:
```bash
# Testa först lokalt
npm run build
npm run dev

# Om allt fungerar
git checkout main
git merge feature/quick-wins
git push origin main

# Ta bort branch (optional)
git branch -d feature/quick-wins
```

## 🎨 Fas 2: Dark Mode & Export Branch

### När Fas 1 är klar:
```bash
git checkout main
git pull
git checkout -b feature/dark-mode-export

# Implementera:
# 1. Dark mode toggle
# 2. CSV export
# 3. Error boundaries
# 4. Performance optimizations
```

## 🔄 Parallel Implementation

### Om du vill köra flera saker samtidigt:
```bash
# Terminal 1 - Quick Wins
git checkout feature/quick-wins
npm run dev

# Terminal 2 - Dark Mode (separat port)
git checkout feature/dark-mode-export  
PORT=3002 npm run dev
```

## 📝 Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Exempel:
```bash
git commit -m "feat(ui): Add loading spinner component

- Created reusable LoadingSpinner component
- Added to all data fetching operations
- Improved perceived performance

Closes #1"
```

## 🏷️ Types:
- **feat**: Ny funktionalitet
- **fix**: Buggfix
- **perf**: Performance förbättring
- **security**: Säkerhetsfix
- **docs**: Dokumentation
- **style**: Formatering (ingen kod-ändring)
- **refactor**: Kod-refaktorering
- **test**: Lägga till tester
- **chore**: Underhåll

## ⚡ Quick Start Implementation

### Vill du att jag börjar nu?

```bash
# Jag kan börja med:
1. ✅ Skapa feature/quick-wins branch
2. ✅ Implementera lazy loading
3. ✅ Lägga till compression
4. ✅ Fixa säkerhetshuvuden
5. ✅ Committa varje ändring

# Du kan sedan:
- Vakna upp till färdiga Quick Wins
- Review koden
- Testa lokalt
- Merge till main när nöjd
```

## 🔒 Säker Implementation

### Varje implementation:
1. **Backup först**: Git commit current state
2. **Små ändringar**: En feature per commit
3. **Test direkt**: Kör lokalt efter varje ändring
4. **Rollback enkelt**: `git reset --hard HEAD~1` om något går fel

## 📊 Branch Status Dashboard

| Branch | Status | Progress | Last Commit |
|--------|--------|----------|-------------|
| main | 🟢 Stable | 100% | 2 min ago |
| feature/quick-wins | 🔄 Active | 30% | Now |
| feature/dark-mode | ⏸️ Planned | 0% | - |
| feature/advanced | 🔵 Future | 0% | - |
