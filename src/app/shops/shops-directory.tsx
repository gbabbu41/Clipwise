"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { MapPin, Star, Search, Scissors, ArrowRight, Users } from "lucide-react";
import { AvatarImage } from "@/components/ui/avatar-image";
import { supabase } from "@/lib/supabase";

interface ShopListing {
  id: string;
  name: string;
  slug: string;
  city: string;
  province: string;
  address: string;
  description?: string;
  logo?: string;
  avgRating?: number;
  reviewCount?: number;
  barberCount?: number;
}

export function ShopsDirectory() {
  const [shops, setShops] = useState<ShopListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("All");
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true); setLoadError(false);
      const { data, error } = await supabase
        .from("shops")
        .select("id, name, slug, city, province, address, description, logo")
        .eq("status", "approved")
        .eq("is_active", true)
        .order("name");
      if (error || !data) { setLoadError(true); setLoading(false); return; }
      if (!data.length) { setShops([]); setLoading(false); return; }

      // Ratings, active barbers, and active services in parallel. A shop only
      // belongs in the public directory once it's actually bookable — at least
      // one active barber AND one active service — so half-finished/empty shops
      // (which would open a dead-end "No services" wizard) never appear.
      const shopIds = data.map((s: { id: string }) => s.id);
      const [{ data: reviews }, { data: barbers }, { data: services }] = await Promise.all([
        supabase.from("reviews").select("shop_id, rating").in("shop_id", shopIds),
        supabase.from("barbers").select("shop_id").in("shop_id", shopIds).eq("is_active", true),
        supabase.from("services").select("shop_id").in("shop_id", shopIds).eq("is_active", true),
      ]);

      const ratingMap: Record<string, { sum: number; count: number }> = {};
      (reviews ?? []).forEach((r: { shop_id: string; rating: number }) => {
        if (!ratingMap[r.shop_id]) ratingMap[r.shop_id] = { sum: 0, count: 0 };
        ratingMap[r.shop_id].sum += r.rating;
        ratingMap[r.shop_id].count += 1;
      });
      const barberCount: Record<string, number> = {};
      (barbers ?? []).forEach((b: { shop_id: string }) => {
        barberCount[b.shop_id] = (barberCount[b.shop_id] ?? 0) + 1;
      });
      const serviceCount: Record<string, number> = {};
      (services ?? []).forEach((s: { shop_id: string }) => {
        serviceCount[s.shop_id] = (serviceCount[s.shop_id] ?? 0) + 1;
      });

      setShops(
        data
          .filter((s: ShopListing) => (barberCount[s.id] ?? 0) > 0 && (serviceCount[s.id] ?? 0) > 0)
          .map((s: ShopListing) => ({
            ...s,
            // Trim so "Moncton" and "Moncton " don't split into two filter chips,
            // and an empty city doesn't render a blank chip / bare comma.
            city: (s.city ?? "").trim(),
            province: (s.province ?? "").trim(),
            avgRating: ratingMap[s.id] ? ratingMap[s.id].sum / ratingMap[s.id].count : undefined,
            reviewCount: ratingMap[s.id]?.count ?? 0,
            barberCount: barberCount[s.id] ?? 0,
          }))
      );
      setLoading(false);
    })().catch(() => { setLoadError(true); setLoading(false); });
  }, [retry]);

  const cities = useMemo(() => {
    const c = new Set(shops.map(s => s.city).filter(Boolean));
    return ["All", ...Array.from(c).sort()];
  }, [shops]);

  const filtered = useMemo(() => {
    let list = shops;
    if (city !== "All") list = list.filter(s => s.city === city);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [shops, city, search]);

  return (
    <>
      {/* hero + search */}
      <section className="blk dir" style={{ paddingBottom: "clamp(32px,5vw,56px)" }}>
        <div className="wrap center" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <span className="badge-warn" style={{ color: "var(--ok)", background: "rgba(255,255,255,.06)", borderColor: "rgba(255,255,255,.16)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Scissors size={14} /> Find your barber
          </span>
          <h1 style={{ fontSize: "clamp(30px,4.6vw,48px)", fontWeight: 700, letterSpacing: "-.035em", lineHeight: 1.08, margin: 0 }}>Book your next cut</h1>
          <p className="lead" style={{ textAlign: "center" }}>Discover barbershops near you and book online in seconds — no app, no account.</p>
          <div className="search" style={{ width: "100%" }}>
            <Search size={18} className="ic" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shops, city, style…" aria-label="Search shops" />
          </div>
        </div>
      </section>

      <section className="blk" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {cities.length > 2 && (
            <div className="chips">
              {cities.map(c => (
                <button key={c} onClick={() => setCity(c)} className={`chip${city === c ? " on" : ""}`}>{c}</button>
              ))}
            </div>
          )}

          <p className="fine" style={{ marginBottom: 20 }}>{loading ? "Finding shops…" : `${filtered.length} shop${filtered.length !== 1 ? "s" : ""} found`}</p>

          {loadError ? (
            <div className="center" role="alert" style={{ paddingBlock: 48 }}><h2>We couldn’t load the shops.</h2><p className="lead" style={{ margin: "16px auto" }}>Please try again in a moment.</p><button className="pill g" onClick={() => setRetry(n => n + 1)}>Try again</button></div>
          ) : loading ? (
            <div className="grid3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="sk" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="center" style={{ paddingBlock: 64 }}>
              <Scissors size={38} style={{ color: "var(--t3)", margin: "0 auto 14px" }} />
              <h2 style={{ fontSize: 20 }}>No shops found</h2>
              <p className="lead" style={{ textAlign: "center", marginTop: 8 }}>{search ? `No results for “${search}”` : "No barbershops available in this area yet."}</p>
              {search && <button onClick={() => setSearch("")} className="pill g" style={{ marginTop: 18 }}>Clear search</button>}
            </div>
          ) : (
            <div className="grid3">
              {filtered.map(shop => (
                <Link key={shop.id} href={`/book/${shop.slug}`} className="scard">
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                    <AvatarImage src={shop.logo} alt={shop.name} className="w-[52px] h-[52px] rounded-xl object-cover flex-shrink-0"
                      fallback={<div className="logo-fb"><Scissors size={22} style={{ color: "var(--ok)" }} /></div>} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="nm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shop.name}</p>
                      {(shop.city || shop.province) && (
                        <div className="meta"><MapPin size={12} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[shop.city, shop.province].filter(Boolean).join(", ")}</span></div>
                      )}
                    </div>
                  </div>

                  {shop.description && <p className="desc">{shop.description}</p>}

                  <div className="srow">
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        {shop.avgRating !== undefined ? (
                          <>
                            <Star size={13} style={{ color: "#E0B341", fill: "#E0B341" }} />
                            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--t1)" }}>{shop.avgRating.toFixed(1)}</span>
                            <span style={{ fontSize: 12, color: "var(--t3)" }}>({shop.reviewCount})</span>
                          </>
                        ) : (
                          <>
                            <Star size={13} style={{ color: "var(--t3)" }} />
                            <span style={{ fontSize: 12, color: "var(--t3)" }}>New</span>
                          </>
                        )}
                      </div>
                      {(shop.barberCount ?? 0) > 0 && (
                        <div className="meta" style={{ marginTop: 0 }}><Users size={11} />{shop.barberCount} barber{shop.barberCount !== 1 ? "s" : ""}</div>
                      )}
                    </div>
                    <span className="book">Book now <ArrowRight size={14} /></span>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* barber CTA */}
          <div className="ctacard" style={{ marginTop: 64 }}>
            <p className="eyebrow" style={{ color: "var(--ok)" }}>Are you a barber or shop owner?</p>
            <h2>Get your shop on ClipWise</h2>
            <p className="lead" style={{ textAlign: "center" }}>Built in Moncton for Canadian barbershops — manage bookings, staff, and payments in one place.</p>
            <Link href="/signup" className="pill w">Get started free</Link>
          </div>
        </div>
      </section>
    </>
  );
}
