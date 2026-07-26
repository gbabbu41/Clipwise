"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { MapPin, Phone, Star, Scissors, Clock, ChevronRight, Mail, Users, MessageSquare, Globe } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { AvatarImage } from "@/components/ui/avatar-image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { Shop, Barber, Service } from "@/lib/database.types";

interface Review {
  id: string;
  client_name?: string;
  rating: number;
  comment?: string;
  created_at: string;
  barbers?: { name: string } | null;
}

function StarRow({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} size={size} className={cn(i < Math.round(rating) ? "text-amber-400 fill-amber-400" : "text-[#999]")} />
      ))}
    </div>
  );
}

export default function ShopProfilePage() {
  const params = useParams();
  const slug = params?.slug as string;

  const [shop, setShop] = useState<Shop | null>(null);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState<"services" | "barbers" | "reviews">("services");
  const [selectedCategory, setSelectedCategory] = useState("All");

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data: shopData } = await supabase
        .from("shops")
        // Public/anon read — explicit columns only (never select("*"), which
        // would leak Stripe ids + owner_id to any visitor).
        .select("id, name, slug, status, logo, description, address, city, province, postal_code, phone, email, website, facebook, instagram, tiktok, youtube")
        .eq("slug", slug)
        .eq("status", "approved")
        .single();
      if (!shopData) { setNotFound(true); setLoading(false); return; }
      setShop(shopData as Shop);

      const [{ data: b }, { data: s }, { data: r }] = await Promise.all([
        // Public shop page — no staff PII / commission / user_id (see booking page).
        supabase.from("barbers").select("id, shop_id, name, photo, bio, rating, total_reviews, is_active").eq("shop_id", shopData.id).eq("is_active", true).order("name"),
        supabase.from("services").select("*").eq("shop_id", shopData.id).eq("is_active", true).order("category").order("name"),
        supabase.from("reviews").select("*, barbers(name)").eq("shop_id", shopData.id).order("created_at", { ascending: false }).limit(20),
      ]);
      setBarbers((b ?? []) as Barber[]);
      setServices((s ?? []) as Service[]);
      setReviews((r ?? []) as unknown as Review[]);
      setLoading(false);
    })();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !shop) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center px-4">
        <Logo size="md" className="justify-center mb-8" />
        <Scissors size={40} className="text-[#999] mb-4" />
        <h1 className="text-xl font-bold text-white mb-2">Shop not found</h1>
        <p className="text-[#6e6e6e] text-sm mb-6">This shop doesn't exist or is no longer active.</p>
        <Link href="/shops"><Button variant="outline">Browse Shops</Button></Link>
      </div>
    );
  }

  const avgRating = reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const categories = ["All", ...Array.from(new Set(services.map(s => s.category)))];
  const filteredServices = selectedCategory === "All" ? services : services.filter(s => s.category === selectedCategory);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-surface border-b border-border sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <Link href="/shops"><Logo size="sm" /></Link>
          <div className="flex gap-3">
            <Link href="/my-bookings" className="hidden sm:block"><Button variant="ghost" size="sm">My Bookings</Button></Link>
            <Link href={`/book/${slug}`}><Button size="sm">Book Now</Button></Link>
          </div>
        </div>
      </header>

      {/* Shop Hero */}
      <div className="bg-surface border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="flex items-start gap-5">
            {/* Logo/Avatar */}
            <div className="flex-shrink-0">
              <AvatarImage src={shop.logo} alt={shop.name} className="w-20 h-20 rounded-2xl object-cover border border-border"
                fallback={
                  <div className="w-20 h-20 rounded-2xl bg-gold/20 border border-gold/30 flex items-center justify-center">
                    <Scissors size={32} className="text-gold" />
                  </div>
                } />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h1 className="text-2xl font-bold text-white">{shop.name}</h1>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {avgRating > 0 && (
                      <div className="flex items-center gap-1.5">
                        <StarRow rating={avgRating} size={14} />
                        <span className="text-sm font-semibold text-white">{avgRating.toFixed(1)}</span>
                        <span className="text-xs text-[#6e6e6e]">({reviews.length} reviews)</span>
                      </div>
                    )}
                    <Badge variant="success" className="text-xs">Open for Booking</Badge>
                  </div>
                </div>
                <Link href={`/book/${slug}`}>
                  <Button>
                    Book Appointment <ChevronRight size={16} />
                  </Button>
                </Link>
              </div>

              {shop.description && (
                <p className="text-sm text-[#6e6e6e] mt-3 leading-relaxed">{shop.description}</p>
              )}

              {/* Contact info */}
              <div className="flex flex-wrap gap-4 mt-4 text-sm text-[#6e6e6e]">
                <span className="flex items-center gap-1.5 min-w-0 break-words"><MapPin size={13} />{shop.address}, {shop.city}, {shop.province} {shop.postal_code}</span>
                {shop.phone && <span className="flex items-center gap-1.5"><Phone size={13} />{shop.phone}</span>}
                {shop.email && <span className="flex items-center gap-1.5"><Mail size={13} />{shop.email}</span>}
              </div>

              {/* Social media links */}
              {(shop.instagram || shop.tiktok || shop.facebook || shop.youtube || shop.website) && (
                <div className="flex flex-wrap gap-3 mt-4">
                  {shop.instagram && (
                    <a href={shop.instagram} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border border-border text-[#6e6e6e] hover:text-pink-400 hover:border-pink-400/40 transition-colors">
                      <Globe size={11} /> Instagram
                    </a>
                  )}
                  {shop.tiktok && (
                    <a href={shop.tiktok} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border border-border text-[#6e6e6e] hover:text-white hover:border-white/40 transition-colors">
                      <Globe size={11} /> TikTok
                    </a>
                  )}
                  {shop.facebook && (
                    <a href={shop.facebook} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border border-border text-[#6e6e6e] hover:text-blue-400 hover:border-blue-400/40 transition-colors">
                      <Globe size={11} /> Facebook
                    </a>
                  )}
                  {shop.youtube && (
                    <a href={shop.youtube} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border border-border text-[#6e6e6e] hover:text-red-400 hover:border-red-400/40 transition-colors">
                      <Globe size={11} /> YouTube
                    </a>
                  )}
                  {shop.website && (
                    <a href={shop.website} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border border-border text-[#6e6e6e] hover:text-gold hover:border-gold/40 transition-colors">
                      <Globe size={11} /> Website
                    </a>
                  )}
                </div>
              )}

              {/* Quick stats */}
              <div className="flex gap-4 mt-4 text-xs text-[#8f8f8f]">
                <span className="flex items-center gap-1"><Users size={11} />{barbers.length} barber{barbers.length !== 1 ? "s" : ""}</span>
                <span className="flex items-center gap-1"><Scissors size={11} />{services.length} service{services.length !== 1 ? "s" : ""}</span>
                {reviews.length > 0 && <span className="flex items-center gap-1"><MessageSquare size={11} />{reviews.length} review{reviews.length !== 1 ? "s" : ""}</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface border-b border-border sticky top-[65px] z-20">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex gap-1">
            {(["services", "barbers", "reviews"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={cn("px-4 py-3.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors",
                  activeTab === tab ? "border-gold text-gold" : "border-transparent text-[#6e6e6e] hover:text-white")}>
                {tab}
                {tab === "reviews" && reviews.length > 0 && (
                  <span className="ml-1.5 text-xs bg-gold/20 text-gold px-1.5 py-0.5 rounded-full">{reviews.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* SERVICES TAB */}
        {activeTab === "services" && (
          <div>
            {categories.length > 2 && (
              <div className="flex gap-2 flex-wrap mb-6">
                {categories.map(cat => (
                  <button key={cat} onClick={() => setSelectedCategory(cat)}
                    className={cn("px-3 py-1.5 text-xs rounded-xl border font-medium transition-colors",
                      selectedCategory === cat ? "bg-gold/15 border-gold/30 text-gold" : "border-border text-[#6e6e6e] hover:text-white")}>
                    {cat}
                  </button>
                ))}
              </div>
            )}
            {filteredServices.length === 0 ? (
              <div className="text-center py-12 text-[#8f8f8f]">
                <Scissors size={32} className="mx-auto mb-3 text-[#999]" />
                <p>No services listed yet</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {filteredServices.map(svc => (
                  <Link key={svc.id} href={`/book/${slug}?service=${svc.id}`}
                    className="bg-surface border border-border rounded-2xl p-5 hover:border-gold/40 transition-colors group flex items-start justify-between gap-4">
                    <div>
                      <p className="text-white font-semibold">{svc.name}</p>
                      {svc.description && <p className="text-xs text-[#8f8f8f] mt-1">{svc.description}</p>}
                      <div className="flex items-center gap-3 mt-2 text-xs text-[#6e6e6e]">
                        <span className="flex items-center gap-1"><Clock size={11} />{svc.duration_minutes} min</span>
                        {svc.category !== "General" && <Badge variant="outline" className="text-xs">{svc.category}</Badge>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-gold font-bold text-lg">{formatCurrency(svc.price)}</p>
                      <p className="text-xs text-[#8f8f8f] group-hover:text-gold transition-colors mt-0.5">Book →</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* BARBERS TAB */}
        {activeTab === "barbers" && (
          <div>
            {barbers.length === 0 ? (
              <div className="text-center py-12 text-[#8f8f8f]">
                <Users size={32} className="mx-auto mb-3 text-[#999]" />
                <p>No barbers listed yet</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {barbers.map(barber => (
                  <Link key={barber.id} href={`/book/${slug}?barber=${barber.id}`}
                    className="bg-surface border border-border rounded-2xl p-5 hover:border-gold/40 transition-colors group flex items-start gap-4">
                    {barber.photo ? (
                      <img src={barber.photo} alt={barber.name} className="w-16 h-16 rounded-full object-cover border border-border flex-shrink-0" />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center flex-shrink-0">
                        <span className="text-gold text-2xl font-bold">{barber.name[0]}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-white font-semibold group-hover:text-gold transition-colors">{barber.name}</h3>
                      {barber.total_reviews > 0 && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <StarRow rating={barber.rating} size={12} />
                          <span className="text-xs text-[#6e6e6e]">{barber.rating.toFixed(1)} ({barber.total_reviews})</span>
                        </div>
                      )}
                      {barber.bio && (
                        <p className="text-xs text-[#8f8f8f] mt-1.5 line-clamp-2">{barber.bio}</p>
                      )}
                      <p className="text-xs text-gold mt-2 group-hover:underline">Book with {barber.name.split(" ")[0]} →</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* REVIEWS TAB */}
        {activeTab === "reviews" && (
          <div>
            {reviews.length === 0 ? (
              <div className="text-center py-12 text-[#8f8f8f]">
                <Star size={32} className="mx-auto mb-3 text-[#999]" />
                <p>No reviews yet — be the first!</p>
                <Link href={`/book/${slug}`} className="mt-4 inline-block">
                  <Button className="mt-4">Book an Appointment</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Rating Summary */}
                <div className="bg-surface border border-border rounded-2xl p-6 flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-5xl font-bold text-white">{avgRating.toFixed(1)}</p>
                    <StarRow rating={avgRating} size={18} />
                    <p className="text-xs text-[#6e6e6e] mt-1">{reviews.length} review{reviews.length !== 1 ? "s" : ""}</p>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {[5, 4, 3, 2, 1].map(star => {
                      const count = reviews.filter(r => Math.round(r.rating) === star).length;
                      const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                      return (
                        <div key={star} className="flex items-center gap-2 text-xs">
                          <span className="text-[#6e6e6e] w-3">{star}</span>
                          <Star size={10} className="text-amber-400 fill-amber-400" />
                          <div className="flex-1 h-1.5 bg-surface-raised rounded-full overflow-hidden">
                            <div className="h-full bg-gold rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[#8f8f8f] w-4 text-right">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Individual reviews */}
                <div className="space-y-3">
                  {reviews.map(review => (
                    <div key={review.id} className="bg-surface border border-border rounded-2xl p-5">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center text-gold text-sm font-semibold">
                            {(review.client_name ?? "A")[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">{review.client_name ?? "Anonymous"}</p>
                            {review.barbers?.name && (
                              <p className="text-xs text-[#8f8f8f]">with {review.barbers.name}</p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <StarRow rating={review.rating} size={12} />
                          <p className="text-xs text-[#8f8f8f] mt-0.5">
                            {new Date(review.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
                          </p>
                        </div>
                      </div>
                      {review.comment && (
                        <p className="text-sm text-gray-300 leading-relaxed">{review.comment}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating Book CTA */}
      <div className="fixed bottom-6 left-0 right-0 flex justify-center z-30 px-4">
        <Link href={`/book/${slug}`}>
          <Button size="lg" className="shadow-lg shadow-gold/20 px-8">
            <Scissors size={18} /> Book an Appointment
          </Button>
        </Link>
      </div>
    </div>
  );
}
