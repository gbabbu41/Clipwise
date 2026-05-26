"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { UserProfile, Shop } from "./database.types";

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  shop: Shop | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshShop: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  shop: null,
  loading: true,
  signOut: async () => {},
  refreshShop: async () => {},
});

async function fetchProfileAndShop(accessToken: string): Promise<{ profile: UserProfile | null; shop: Shop | null }> {
  const res = await fetch("/api/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { profile: null, shop: null };
  return res.json();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshShop = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    const { shop: s } = await fetchProfileAndShop(session.access_token);
    setShop(s);
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      if (session?.access_token) {
        const { profile: p, shop: s } = await fetchProfileAndShop(session.access_token);
        if (!mounted) return;
        setProfile(p);
        setShop(s);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      if (session?.access_token) {
        const { profile: p, shop: s } = await fetchProfileAndShop(session.access_token);
        if (!mounted) return;
        setProfile(p);
        setShop(s);
      } else {
        setProfile(null);
        setShop(null);
      }
      setLoading(false);
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
  };

  return (
    <AuthContext.Provider value={{ user, profile, shop, loading, signOut, refreshShop }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
