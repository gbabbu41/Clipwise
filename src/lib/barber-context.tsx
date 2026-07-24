"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "./auth-context";
import type { Barber, Shop } from "./database.types";

interface BarberContextType {
  barber: Barber | null;       // active barber row (one per shop)
  shop: Shop | null;           // active shop
  barbers: Barber[];           // all barber rows for this user (multi-shop)
  shops: Shop[];               // all shops for those barber rows
  loading: boolean;
  error: string | null;
  setActiveShop: (s: Shop) => void;
}

const BarberContext = createContext<BarberContextType>({
  barber: null, shop: null, barbers: [], shops: [],
  loading: true, error: null, setActiveShop: () => {},
});

const ACTIVE_KEY = (userId: string) => `clipwise_active_barber_shop_${userId}`;

export function BarberProvider({ children }: { children: React.ReactNode }) {
  const { accessToken, user, signOut } = useAuth();
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setActiveShop = useCallback((s: Shop) => {
    setShop(s);
    if (user?.id) localStorage.setItem(ACTIVE_KEY(user.id), s.id);
  }, [user?.id]);

  // Derive active barber from active shop
  const barber = shop ? barbers.find(b => b.shop_id === shop.id) ?? null : null;

  useEffect(() => {
    if (!accessToken) { setLoading(false); return; }
    let cancelled = false;
    fetch("/api/barber/me", { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async r => {
        // Expired/revoked token → sign out to /login, NOT the "account not
        // linked" screen (a lapsed token was telling barbers they'd been removed).
        if (r.status === 401) { await signOut(); return null; }
        return r.ok ? r.json() : { error: "Couldn't load your profile — please try again." };
      })
      .then(data => {
        if (cancelled || !data) return;
        const { barbers: bs, shops: ss, error: e } = data;
        if (e) { setError(e); return; }
        const barberList: Barber[] = bs ?? [];
        const shopList: Shop[] = ss ?? [];
        setBarbers(barberList);
        setShops(shopList);

        // Pick the active shop: localStorage preference → first shop
        const stored = user?.id ? localStorage.getItem(ACTIVE_KEY(user.id)) : null;
        const preferred = stored ? shopList.find(s => s.id === stored) : null;
        setShop(preferred ?? shopList[0] ?? null);
      })
      .catch(() => { if (!cancelled) setError("Couldn't load your profile — check your connection and try again."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken, user?.id, signOut]);

  return (
    <BarberContext.Provider value={{ barber, shop, barbers, shops, loading, error, setActiveShop }}>
      {children}
    </BarberContext.Provider>
  );
}

export const useBarber = () => useContext(BarberContext);
