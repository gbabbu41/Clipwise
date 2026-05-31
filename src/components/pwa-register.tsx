'use client';

import { useEffect } from 'react';

export function PWARegister() {
  useEffect(() => {
    // Never register the SW in development — it caches JS bundles, which
    // causes stale code to be served on a normal refresh (only a hard
    // refresh would bypass the cache). Also proactively unregister any
    // dev-mode SW that a previous build may have left behind.
    if (process.env.NODE_ENV !== 'production') {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(regs => {
          regs.forEach(r => r.unregister());
        }).catch(() => {});
      }
      return;
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  return null;
}
