"use client";
import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";

/**
 * Shows the dashboard's notice bars ONE AT A TIME instead of letting three pop
 * up on top of each other when the owner lands. Each bar reports whether it wants
 * to show; only the highest-priority one that wants to show actually renders. When
 * it's dismissed or resolved it drops out, and the next one slides in on its own
 * (its mount animation makes that smooth). Lower index = higher priority.
 */
const PRIORITY = ["self-barber", "stripe", "trial", "setup-nudge"] as const;
export type BannerKey = typeof PRIORITY[number];

type Ctx = {
  active: BannerKey[];
  register: (k: BannerKey) => void;
  unregister: (k: BannerKey) => void;
};
const BannerCtx = createContext<Ctx | null>(null);

export function BannerCoordinatorProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<BannerKey[]>([]);
  const register = useCallback((k: BannerKey) => {
    setActive(prev => (prev.includes(k) ? prev : [...prev, k]));
  }, []);
  const unregister = useCallback((k: BannerKey) => {
    setActive(prev => (prev.includes(k) ? prev.filter(x => x !== k) : prev));
  }, []);
  const value = useMemo(() => ({ active, register, unregister }), [active, register, unregister]);
  return <BannerCtx.Provider value={value}>{children}</BannerCtx.Provider>;
}

/**
 * Call unconditionally from a banner (before any early return). `wants` is the
 * banner's own "I have something to show" condition. Returns true only when this
 * banner is allowed to be on screen right now (it wants to AND nothing
 * higher-priority is showing). Falls back to `wants` if there's no provider.
 */
export function useBannerSlot(key: BannerKey, wants: boolean): boolean {
  const ctx = useContext(BannerCtx);
  useEffect(() => {
    if (!ctx) return;
    if (wants) ctx.register(key); else ctx.unregister(key);
    return () => ctx.unregister(key);
  }, [ctx, key, wants]);
  if (!ctx) return wants;
  if (!wants) return false;
  const myIdx = PRIORITY.indexOf(key);
  // Hidden while any higher-priority bar is also asking to show.
  return !ctx.active.some(k => PRIORITY.indexOf(k) < myIdx);
}
