"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { UserProfile, Shop } from "./database.types";
import { hydratePlanConfig } from "./validation";
import { planRowsToConfig, type PlanRow } from "./plans";

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  shop: Shop | null;
  shops: Shop[];
  plans: PlanRow[];
  loading: boolean;
  accessToken: string | null;
  signOut: () => Promise<void>;
  refreshShop: () => Promise<void>;
  setActiveShop: (shop: Shop) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  shop: null,
  shops: [],
  plans: [],
  loading: true,
  accessToken: null,
  signOut: async () => {},
  refreshShop: async () => {},
  setActiveShop: () => {},
});

// Remember which location a multi-shop owner last selected, so switching sticks
// across reloads instead of snapping back to the newest shop (which used to
// bounce owners to /dashboard/pending when the newest shop was awaiting review).
const ACTIVE_SHOP_KEY = "cw_active_shop";

async function fetchProfileAndShop(accessToken: string): Promise<{ profile: UserProfile | null; shop: Shop | null; shops: Shop[]; unauthorized?: boolean }> {
  try {
    const res = await fetch("/api/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // A dead/expired token → signal it so the caller signs out and redirects to
    // /login, rather than rendering with a null profile (which used to show
    // owners a false "No shop found").
    if (res.status === 401) return { profile: null, shop: null, shops: [], unauthorized: true };
    if (!res.ok) return { profile: null, shop: null, shops: [] };
    return res.json();
  } catch {
    // Network error (offline) — NOT an auth failure, so don't sign the user out.
    return { profile: null, shop: null, shops: [] };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Load admin-editable plans once and hydrate the sync gating config so the
  // sidebar / page locks reflect the live DB (falls back to defaults on error).
  useEffect(() => {
    let active = true;
    fetch("/api/plans")
      .then((r) => (r.ok ? r.json() : { plans: [] }))
      .then(({ plans: rows }: { plans?: PlanRow[] }) => {
        if (!active || !rows?.length) return;
        setPlans(rows);
        hydratePlanConfig(planRowsToConfig(rows));
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const setActiveShop = useCallback((s: Shop) => {
    setShop(s);
    try { localStorage.setItem(ACTIVE_SHOP_KEY, s.id); } catch { /* storage unavailable */ }
  }, []);

  const refreshShop = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    const { profile: p, shop: s, shops: all, unauthorized } = await fetchProfileAndShop(session.access_token);
    if (unauthorized) { await supabase.auth.signOut(); return; }
    if (p) setProfile(p); // keep the profile (incl. avatar) fresh, not just the shop
    if (all.length > 0) setShops(all);
    setShop(prev => {
      if (!prev) return s;
      const refreshed = all.find(x => x.id === prev.id);
      return refreshed ?? s;
    });
  }, []);

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      setAccessToken(session?.access_token ?? null);
      try {
        if (session?.access_token) {
          const { profile: p, shop: s, shops: all, unauthorized } = await fetchProfileAndShop(session.access_token);
          if (!mounted) return;
          if (unauthorized) { await supabase.auth.signOut(); return; }
          setProfile(p);
          setShops(all);
          // Restore the owner's last-selected location if it still exists,
          // otherwise fall back to the server default (newest shop).
          let active = s;
          try {
            const savedId = localStorage.getItem(ACTIVE_SHOP_KEY);
            if (savedId) { const found = all.find(x => x.id === savedId); if (found) active = found; }
          } catch { /* storage unavailable */ }
          setShop(active);
        } else {
          setProfile(null);
          setShop(null);
          setShops([]);
          setAccessToken(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Listen for subscription changes (webhook updates) and refresh shop data
  useEffect(() => {
    if (!shop?.id) return;
    const channel = supabase
      .channel(`shop-sub-${shop.id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "shops",
        filter: `id=eq.${shop.id}`,
      }, () => { refreshShop(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [shop?.id, refreshShop]);

  const signOut = async () => {
    await supabase.auth.signOut();
    // Clear the bearer token immediately too — so no component can read a stale
    // token in the window between sign-out and the SIGNED_OUT event firing.
    // (plans is non-sensitive global pricing config; leave it.)
    setUser(null);
    setProfile(null);
    setShop(null);
    setShops([]);
    setAccessToken(null);
    try { localStorage.removeItem(ACTIVE_SHOP_KEY); } catch { /* storage unavailable */ }
  };

  return (
    <AuthContext.Provider value={{ user, profile, shop, shops, plans, loading, accessToken, signOut, refreshShop, setActiveShop }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
