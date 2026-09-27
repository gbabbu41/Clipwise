// Tiny per-viewer, on-device cache for INSTANT paint. A screen renders its last
// snapshot immediately, then refreshes from the network and overwrites — so the
// app opens showing real content instead of a spinner.
//
// Scope + privacy: values live ONLY in this browser's localStorage (never sent
// anywhere), and `clearViewCache()` runs on sign-out so nothing — including any
// cached client names — lingers on a shared device. Every access is wrapped so a
// private window, disabled storage, or a full quota never throws.
const PREFIX = "cw_vc_";
// In-memory layer: switching tabs in the same session reuses the last snapshot
// without touching localStorage. Snapshots over ~900 KB (e.g. a shop's full
// payment history) stay memory-only so they can't blow the ~5 MB storage quota.
const mem = new Map<string, unknown>();
const MAX_PERSIST_CHARS = 900_000;

export function cacheGet<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  if (mem.has(key)) return mem.get(key) as T;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function cacheSet(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  mem.set(key, value);
  try {
    const json = JSON.stringify(value);
    if (json.length > MAX_PERSIST_CHARS) { window.localStorage.removeItem(PREFIX + key); return; }
    window.localStorage.setItem(PREFIX + key, json);
  } catch {
    // Quota exceeded (or storage blocked) — drop our own cached entries so a fresh
    // write can succeed next time, and never let it bubble up.
    try {
      Object.keys(window.localStorage).forEach(k => { if (k.startsWith(PREFIX)) window.localStorage.removeItem(k); });
    } catch { /* ignore */ }
  }
}

export function clearViewCache(): void {
  if (typeof window === "undefined") return;
  mem.clear();
  try {
    Object.keys(window.localStorage).forEach(k => { if (k.startsWith(PREFIX)) window.localStorage.removeItem(k); });
  } catch { /* ignore */ }
}
