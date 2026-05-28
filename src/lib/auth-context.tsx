"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { UserProfile, Shop } from "./database.types";

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  shop: Shop | null;
  shops: Shop[];
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
  loading: true,
  accessToken: null,
  signOut: async () => {},
  refreshShop: async () => {},
  setActiveShop: () => {},
});

async function fetchProfileAndShop(accessToken: string): Promise<{ profile: UserProfile | null; shop: Shop | null; shops: Shop[] }> {
  const res = await fetch("/api/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { profile: null, shop: null, shops: [] };
  return res.json();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const setActiveShop = useCallback((s: Shop) => {
    setShop(s);
  }, []);

  const refreshShop = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    const { shop: s, shops: all } = await fetchProfileAndShop(session.access_token);
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
          const { profile: p, shop: s, shops: all } = await fetchProfileAndShop(session.access_token);
          if (!mounted) return;
          setProfile(p);
          setShops(all);
          setShop(s);
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

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setShop(null);
    setShops([]);
  };

  return (
    <AuthContext.Provider value={{ user, profile, shop, shops, loading, accessToken, signOut, refreshShop, setActiveShop }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
