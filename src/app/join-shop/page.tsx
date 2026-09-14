"use client";
import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { Search, MapPin, Check, Scissors } from "lucide-react";
import { MKT_CSS } from "@/lib/marketing-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

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

  const infoFields = [
    { key: "name" as const, label: "Your name", placeholder: "John Doe" },
    { key: "email" as const, label: "Your email", placeholder: "john@example.com" },
    { key: "phone" as const, label: "Phone (optional)", placeholder: "+1 (506) 555-0123" },
  ];

  return (
    <div className="mkt">
      <style dangerouslySetInnerHTML={{ __html: MKT_CSS }} />

      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 100, background: "rgba(59,209,161,.14)", border: "1px solid rgba(59,209,161,.35)", borderRadius: 12, padding: "12px 18px", fontSize: 14, color: "#7fe6c4", display: "flex", alignItems: "center", gap: 8, boxShadow: "0 20px 50px rgba(0,0,0,.5)" }}>
          <Check size={15} /> {toast}
        </div>
      )}

      {/* header */}
      <header style={{ position: "sticky", top: 0, zIndex: 30, background: "rgba(8,8,10,.7)", backdropFilter: "blur(18px)", borderBottom: "1px solid var(--line)" }}>
        <div className="wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <Link href="/" className="brand" style={{ fontWeight: 800, letterSpacing: "-.045em", fontSize: 16, color: "var(--t1)" }}>CLIPWISE</Link>
          <Link href="/dashboard" className="pill g" style={{ padding: "8px 16px", fontSize: 13.5 }}>Dashboard</Link>
        </div>
      </header>

      <section className="blk" style={{ paddingTop: "clamp(36px,6vw,64px)", paddingBottom: "clamp(28px,4vw,44px)" }}>
        <div className="wrap center" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <span className="badge-warn" style={{ color: "var(--ok)", background: "rgba(59,209,161,.1)", borderColor: "rgba(59,209,161,.25)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Scissors size={14} /> Join a barbershop
          </span>
          <h1 style={{ fontSize: "clamp(26px,4vw,38px)", fontWeight: 700, letterSpacing: "-.03em", margin: 0 }}>Find your next barbershop</h1>
          <p className="lead" style={{ textAlign: "center" }}>Browse approved shops and send a join request directly to the owner.</p>
        </div>
      </section>

      <section className="blk" style={{ paddingTop: 0, paddingBottom: "clamp(56px,8vw,100px)" }}>
        <div className="wrap" style={{ maxWidth: 880, display: "flex", flexDirection: "column", gap: 22 }}>
          {/* barber info */}
          <div className="scard" style={{ transform: "none" }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Your info <span style={{ color: "var(--t3)", fontWeight: 400 }}>(sent with join requests)</span></h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="jg">
              {infoFields.map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label style={{ fontSize: 12.5, color: "var(--t3)", display: "block", marginBottom: 6 }}>{label}</label>
                  <input className="tinput" value={barberForm[key]} onChange={e => setBarberForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} />
                </div>
              ))}
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: 12.5, color: "var(--t3)", display: "block", marginBottom: 6 }}>Short bio (optional)</label>
                <textarea className="tinput" rows={2} value={barberForm.bio} onChange={e => setBarberForm(f => ({ ...f, bio: e.target.value }))} placeholder="Tell the shop owner about your experience…" style={{ resize: "none" }} />
              </div>
            </div>
          </div>

          {/* search */}
          <div className="search" style={{ maxWidth: "none", margin: 0 }}>
            <Search size={16} className="ic" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by shop name or city…" aria-label="Search shops" />
          </div>

          {/* shops */}
          {loading ? (
            <div className="grid3" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>{Array.from({ length: 4 }).map((_, i) => <div key={i} className="sk" style={{ height: 110 }} />)}</div>
          ) : filtered.length === 0 ? (
            <div className="center" style={{ paddingBlock: 48 }}>
              <Scissors size={34} style={{ color: "var(--t3)", margin: "0 auto 12px" }} />
              <p className="lead" style={{ textAlign: "center" }}>{search ? `No shops found for “${search}”` : "No approved shops available yet."}</p>
            </div>
          ) : (
            <div className="grid3" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
              {filtered.map(shop => {
                const requested = requestedIds.has(shop.id);
                return (
                  <div key={shop.id} className="scard" style={{ transform: "none", borderColor: requested ? "rgba(59,209,161,.3)" : undefined }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <p className="nm" style={{ fontSize: 16 }}>{shop.name}</p>
                        <div className="meta"><MapPin size={11} /><span>{[shop.city, shop.province].filter(Boolean).join(", ")}</span></div>
                      </div>
                      {requested ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--ok)", fontWeight: 600, flex: "none" }}><Check size={13} /> Sent</span>
                      ) : (
                        <button className="pill w" onClick={() => requestJoin(shop)} disabled={sendingId === shop.id} style={{ flex: "none", fontSize: 13, padding: "9px 16px", border: "none", cursor: "pointer" }}>
                          {sendingId === shop.id ? "Sending…" : "Request to join"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <style dangerouslySetInnerHTML={{ __html: "@media(max-width:600px){.mkt .jg{grid-template-columns:1fr!important}.mkt .grid3{grid-template-columns:1fr!important}}" }} />
    </div>
  );
}
