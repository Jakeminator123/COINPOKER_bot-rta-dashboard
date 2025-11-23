# 🛠️ Implementation Guide - Exakt hur du gör Quick Wins

## 1. Performance: Lazy Loading (5 min)
```tsx
// I alla komponenter med bilder:
<img src={url} loading="lazy" alt={description} />
```

## 2. Performance: Gzip Compression (5 min)
```js
// next.config.js
module.exports = {
  compress: true, // Aktiverar gzip
  // ... resten av config
}
```

## 3. Säkerhet: Ta bort X-Powered-By (2 min)
```js
// next.config.js
module.exports = {
  poweredByHeader: false,
  // ... resten
}
```

## 4. Säkerhet: Rate Limiting (15 min)
```bash
npm install express-rate-limit
```

```ts
// app/api/signal/route.ts
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minut
  max: 100, // max 100 requests
  message: 'Too many requests'
});

export async function POST(request: Request) {
  // Applicera rate limit här
  // ... resten av koden
}
```

## 5. UX: Loading Spinner (10 min)
```tsx
// components/LoadingSpinner.tsx
export function LoadingSpinner() {
  return (
    <div className="flex justify-center items-center p-8">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
    </div>
  );
}

// Använd i komponenter:
{isLoading ? <LoadingSpinner /> : <YourContent />}
```

## 6. UX: Empty State (10 min)
```tsx
// components/EmptyState.tsx
export function EmptyState({ message = "No data available" }) {
  return (
    <div className="text-center py-12 text-slate-400">
      <p className="text-lg">{message}</p>
      <p className="text-sm mt-2">Data will appear when devices connect</p>
    </div>
  );
}
```

## 7. Säkerhet: Validera device_id (10 min)
```ts
// lib/validation.ts
export function isValidDeviceId(id: string): boolean {
  // MD5 hash är alltid 32 hex-tecken
  return /^[a-f0-9]{32}$/i.test(id);
}

// I API routes:
if (!isValidDeviceId(device_id)) {
  return Response.json({ error: 'Invalid device ID' }, { status: 400 });
}
```

## 8. Mobilvy: Responsiv tabell (15 min)
```css
/* globals.css eller komponent-CSS */
.table-container {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

@media (max-width: 768px) {
  table {
    min-width: 600px; /* Forcera horisontell scroll på mobil */
  }
}
```

## 9. Error Boundary (20 min)
```tsx
// components/ErrorBoundary.tsx
'use client';

import { Component, ReactNode } from 'react';

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center">
          <h2 className="text-xl text-red-500">Something went wrong</h2>
          <button 
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-cyan-600 rounded"
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// I layout.tsx:
<ErrorBoundary>
  {children}
</ErrorBoundary>
```

## 10. Miljövariabler (.env.example) (5 min)
```bash
# .env.example
REDIS_URL=redis://user:pass@host:port
SIGNAL_TOKEN=your-secret-token-here
NODE_ENV=production
```

## Total tid: ~90 minuter
Alla dessa förbättringar ger omedelbar effekt utan att bryta något!
