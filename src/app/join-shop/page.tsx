"use client";
import { useState, useMemo } from "react";
import { useEffect } from "react";
import Link from "next/link";
import { Search, MapPin, Check, Scissors } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

interface ShopListing {
  id: string;
  name: string;
  slug: string;
  city: string;
  province: string;
  email: string;
  owner_id: string;
  users?: { name: string; email: string };
}

export default function JoinShopPage() {
  const { profile } = useAuth();
  const [shops, setShops] = useState<ShopListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [barberForm, setBarberForm] = useState({ name: profile?.name ?? "", email: profile?.email ?? "", phone: "", bio: "" });

  useEffect(() => {
    if (profile) {
      setBarberForm(f => ({ ...f, name: profile.name ?? "", email: profile.email ?? "" }));
    }
  }, [profile]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("shops")
        .select("id, name, slug, city, province, email, owner_id, users(name, email)")
        .eq("status", "approved")
        .eq("is_active", true)
        .order("name");
      setShops((data ?? []) as unknown as ShopListing[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return shops;
    const q = search.toLowerCase();
    return shops.filter(s => s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q));
  }, [shops, search]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  const requestJoin = async (shop: ShopListing) => {
    if (!barberForm.name.trim()) { showToast("Please enter your name above."); return; }
    setSendingId(shop.id);

    // Get shop owner email
    const ownerEmail = (shop.users as unknown as { email: string } | null)?.email ?? shop.email;

    await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "new_barber_request",
        data: {
          barberName: barberForm.name,
          barberEmail: barberForm.email,
          barberPhone: barberForm.phone,
          bio: barberForm.bio,
          shopName: shop.name,
          ownerEmail,
        },
      }),
    }).catch(() => null);

    setRequestedIds(prev => new Set(prev).add(shop.id));
    setSendingId(null);
    showToast(`Request sent to ${shop.name}!`);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] bg-emerald-900/80 border border-emerald-500/40 rounded-xl px-5 py-3 text-sm text-emerald-300 flex items-center gap-3 shadow-xl">
          <Check size={15} /> {toast}
        </div>
      )}

      {/* Header */}
      <header className="bg-surface border-b border-border sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <Link href="/"><Logo size="sm" /></Link>
          <Link href="/dashboard">
            <Button variant="outline" size="sm">Dashboard</Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-surface border-b border-border py-10">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-gold/10 border border-gold/20 rounded-full px-4 py-1.5 text-gold text-sm font-medium mb-4">
            <Scissors size={14} /> Join a Barbershop
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">Find Your Next Barbershop</h1>
          <p className="text-[#8f8f8f] text-sm">Browse approved shops and send a join request directly to the owner.</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Barber Info */}
        <div className="bg-surface border border-gold/20 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-white mb-4">Your Info (sent with join requests)</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { key: "name" as const, label: "Your Name", placeholder: "John Doe" },
              { key: "email" as const, label: "Your Email", placeholder: "john@example.com" },
              { key: "phone" as const, label: "Phone (optional)", placeholder: "+1 (506) 555-0123" },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="text-xs text-[#8f8f8f] block mb-1.5">{label}</label>
                <input
                  value={barberForm[key]}
                  onChange={e => setBarberForm(f => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full bg-surface-raised border border-border rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-gold/50"
                />
              </div>
            ))}
            <div className="sm:col-span-2">
              <label className="text-xs text-[#8f8f8f] block mb-1.5">Short Bio (optional)</label>
              <textarea
                value={barberForm.bio}
                onChange={e => setBarberForm(f => ({ ...f, bio: e.target.value }))}
                rows={2}
                placeholder="Tell the shop owner about your experience..."
                className="w-full bg-surface-raised border border-border rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-gold/50 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f8f8f]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by shop name or city..."
            className="w-full bg-surface-raised border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-gold/50"
          />
        </div>

        {/* Shops */}
        {loading ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 bg-surface-raised rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-[#8f8f8f]">
            <Scissors size={36} className="mx-auto mb-3 text-[#8f8f8f]" />
            <p className="text-sm">{search ? `No shops found for "${search}"` : "No approved shops available yet."}</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {filtered.map(shop => {
              const requested = requestedIds.has(shop.id);
              return (
                <div key={shop.id} className={cn("bg-surface border rounded-2xl p-5 transition-colors", requested ? "border-emerald-500/30" : "border-border hover:border-gold/30")}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-white font-semibold">{shop.name}</h3>
                      <div className="flex items-center gap-1 text-[#8f8f8f] text-xs mt-1">
                        <MapPin size={11} />
                        <span>{shop.city}, {shop.province}</span>
                      </div>
                    </div>
                    {requested ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium flex-shrink-0">
                        <Check size={13} /> Sent
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        loading={sendingId === shop.id}
                        onClick={() => requestJoin(shop)}
                        className="flex-shrink-0"
                      >
                        Request to Join
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
