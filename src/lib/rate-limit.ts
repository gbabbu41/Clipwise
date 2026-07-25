// Best-effort in-memory rate limiter for public / abuse-prone API routes.
//
// HONEST LIMITATION: on Vercel each serverless instance keeps its own counter,
// so a determined attacker who lands on fresh instances can exceed these limits.
// This blunts naive floods and accidental hammering (the common case) with zero
// infra. For production-grade guarantees, back this with Upstash/Redis and swap
// the Map for a shared store — the call sites won't change.
import { NextResponse } from "next/server";

interface Bucket { count: number; reset: number }
const store = new Map<string, Bucket>();

/** Extract the client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const h = req.headers;
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") || "unknown";
}

/**
 * Fixed-window limiter. Returns ok:false once `limit` hits occur within
 * `windowMs` for a given key. Prunes expired buckets opportunistically so the
 * Map can't grow without bound.
 */
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();

  // Opportunistic prune (cheap; only when the map is getting large).
  if (store.size > 5000) {
    store.forEach((v, k) => { if (now > v.reset) store.delete(k); });
  }

  const b = store.get(key);
  if (!b || now > b.reset) {
    store.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  b.count++;
  if (b.count > limit) return { ok: false, retryAfter: Math.ceil((b.reset - now) / 1000) };
  return { ok: true, retryAfter: 0 };
}

/**
 * Convenience for route handlers: enforce a per-IP limit on a named bucket and
 * return a ready 429 NextResponse when exceeded, or null when allowed.
 *
 *   const limited = enforceRateLimit(req, "book", 10, 60_000);
 *   if (limited) return limited;
 */
export function enforceRateLimit(req: Request, bucket: string, limit: number, windowMs: number): NextResponse | null {
  const { ok, retryAfter } = rateLimit(`${bucket}:${clientIp(req)}`, limit, windowMs);
  if (ok) return null;
  return NextResponse.json(
    { error: "Too many requests — please slow down and try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
