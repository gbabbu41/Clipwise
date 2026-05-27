"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { MapPin, Star, Search, Scissors, ArrowRight, Users } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

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

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-surface-raised rounded-2xl", className)} />;
}

export default function ShopsPage() {
  const [shops, setShops] = useState<ShopListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("All");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("shops")
        .select("id, name, slug, city, province, address, description, logo")
        .eq("status", "approved")
        .eq("is_active", true)
        .order("name");
      if (!data) { setLoading(false); return; }

      // Fetch ratings and barber counts in parallel
      const shopIds = data.map((s: { id: string }) => s.id);
      const [{ data: reviews }, { data: barbers }] = await Promise.all([
        supabase.from("reviews").select("shop_id, rating").in("shop_id", shopIds),
        supabase.from("barbers").select("shop_id").in("shop_id", shopIds).eq("is_active", true),
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

      setShops(data.map((s: ShopListing) => ({
        ...s,
        avgRating: ratingMap[s.id] ? ratingMap[s.id].sum / ratingMap[s.id].count : undefined,
        reviewCount: ratingMap[s.id]?.count ?? 0,
        barberCount: barberCount[s.id] ?? 0,
      })));
      setLoading(false);
    })();
  }, []);

  const cities = useMemo(() => {
    const c = new Set(shops.map(s => s.city));
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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-surface border-b border-border sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <Link href="/"><Logo size="sm" /></Link>
          <div className="flex gap-3">
            <Link href="/my-bookings"><Button variant="ghost" size="sm">My Bookings</Button></Link>
            <Link href="/login"><Button variant="outline" size="sm">Sign In</Button></Link>
            <Link href="/signup"><Button size="sm">Get Started</Button></Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-surface border-b border-border py-12">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-gold/10 border border-gold/20 rounded-full px-4 py-1.5 text-gold text-sm font-medium mb-4">
            <Scissors size={14} /> Find Your Barber
          </div>
          <h1 className="text-4xl font-bold text-white mb-3">Book Your Next Cut</h1>
          <p className="text-gray-400 text-lg mb-8">Discover the best barbershops near you. Book online in seconds.</p>

          {/* Search */}
          <div className="max-w-xl mx-auto">
            <div className="relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search shops, city, style..."
                className="w-full bg-surface-raised border border-border rounded-2xl pl-12 pr-4 py-3.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* City Filter */}
        {cities.length > 2 && (
          <div className="flex gap-2 flex-wrap mb-6">
            {cities.map(c => (
              <button key={c} onClick={() => setCity(c)}
                className={cn("px-4 py-1.5 rounded-xl text-sm font-medium transition-colors border",
                  city === c ? "bg-gold text-black border-gold" : "border-border text-gray-400 hover:text-white bg-surface-raised")}>
                {c}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-gray-500">
            {loading ? "Finding shops..." : `${filtered.length} shop${filtered.length !== 1 ? "s" : ""} found`}
          </p>
        </div>

        {/* Shop Grid */}
        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Scissors size={40} className="text-gray-600 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">No shops found</h2>
            <p className="text-gray-500 text-sm">
              {search ? `No results for "${search}"` : "No barbershops available in this area yet."}
            </p>
            {search && (
              <button onClick={() => setSearch("")} className="mt-4 text-gold text-sm hover:underline">Clear search</button>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map(shop => (
              <Link key={shop.id} href={`/shops/${shop.slug}`}
                className="group bg-surface border border-border rounded-2xl p-6 hover:border-gold/40 hover:shadow-lg hover:shadow-gold/5 transition-all duration-200 block">
                <div className="flex items-start gap-4 mb-4">
                  {shop.logo ? (
                    <img src={shop.logo} alt={shop.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-gold/20 border border-gold/30 flex items-center justify-center flex-shrink-0">
                      <Scissors size={22} className="text-gold" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h2 className="text-white font-bold text-lg group-hover:text-gold transition-colors truncate">{shop.name}</h2>
                    <div className="flex items-center gap-1 text-gray-500 text-sm mt-0.5">
                      <MapPin size={12} />
                      <span className="truncate">{shop.city}, {shop.province}</span>
                    </div>
                  </div>
                </div>

                {shop.description && (
                  <p className="text-sm text-gray-400 leading-relaxed mb-4 line-clamp-2">{shop.description}</p>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      {shop.avgRating !== undefined ? (
                        <>
                          <Star size={13} className="text-gold fill-gold" />
                          <span className="text-sm font-semibold text-white">{shop.avgRating.toFixed(1)}</span>
                          <span className="text-xs text-gray-500">({shop.reviewCount})</span>
                        </>
                      ) : (
                        <>
                          <Star size={13} className="text-gray-600" />
                          <span className="text-xs text-gray-500">New</span>
                        </>
                      )}
                    </div>
                    {(shop.barberCount ?? 0) > 0 && (
                      <div className="flex items-center gap-1 text-gray-500 text-xs">
                        <Users size={11} />
                        {shop.barberCount} barber{shop.barberCount !== 1 ? "s" : ""}
                      </div>
                    )}
                  </div>
                  <span className="text-gold text-sm font-semibold group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                    Book Now <ArrowRight size={14} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* CTA for barbers */}
        <div className="mt-16 bg-surface border border-gold/20 rounded-2xl p-8 text-center">
          <p className="text-gold text-sm font-medium mb-2">Are you a barber or shop owner?</p>
          <h2 className="text-2xl font-bold text-white mb-3">Get Your Shop on ClipWise</h2>
          <p className="text-gray-400 text-sm mb-6 max-w-lg mx-auto">Join hundreds of barbershops using ClipWise to manage bookings, staff, and payments — all in one place.</p>
          <Link href="/signup"><Button size="lg">Start Free Trial →</Button></Link>
        </div>
      </div>
    </div>
  );
}
