"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "./auth-context";
import type { Barber, Shop } from "./database.types";

interface BarberContextType {
  barber: Barber | null;
  shop: Shop | null;
  loading: boolean;
  error: string | null;
}

const BarberContext = createContext<BarberContextType>({ barber: null, shop: null, loading: true, error: null });

export function BarberProvider({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuth();
  const [barber, setBarber] = useState<Barber | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) { setLoading(false); return; }
    fetch("/api/barber/me", { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.json())
      .then(({ barber: b, shop: s, error: e }) => {
        if (e) setError(e);
        else { setBarber(b); setShop(s); }
      })
      .catch(() => setError("Failed to load barber profile"))
      .finally(() => setLoading(false));
  }, [accessToken]);

  return (
    <BarberContext.Provider value={{ barber, shop, loading, error }}>
      {children}
    </BarberContext.Provider>
  );
}

export const useBarber = () => useContext(BarberContext);
