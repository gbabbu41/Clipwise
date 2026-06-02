"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { Review, Barber } from "@/lib/database.types";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-black">✓</span>{message}
      <button onClick={onClose} className="text-[#777] hover:text-white ml-2">✕</button>
    </div>
  );
}

function Stars({ rating, size = "md" }: { rating: number; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "text-sm", md: "text-base", lg: "text-xl" };
  return <span className={cn("text-black", sizes[size])}>{"★".repeat(rating)}{"☆".repeat(5 - rating)}</span>;
}

export default function ReviewsPage() {
  const { shop } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratingFilter, setRatingFilter] = useState("all");
  const [barberFilter, setBarberFilter] = useState("all");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const loadData = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const [revRes, barberRes] = await Promise.all([
      supabase.from("reviews").select("*").eq("shop_id", shop.id).order("created_at", { ascending: false }),
      supabase.from("barbers").select("id, name").eq("shop_id", shop.id),
    ]);
    if (revRes.data) setReviews(revRes.data);
    if (barberRes.data) setBarbers(barberRes.data as Barber[]);
    setLoading(false);
  }, [shop]);

  useEffect(() => { loadData(); }, [loadData]);

  const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : "0.0";
  const ratingBreakdown = [5, 4, 3, 2, 1].map(r => ({
    stars: r,
    count: reviews.filter(rev => rev.rating === r).length,
  }));
  const replied = reviews.filter(r => r.reply).map(r => r.id);

  const filtered = useMemo(() => {
    let list = [...reviews];
    if (barberFilter !== "all") list = list.filter(r => r.barber_id === barberFilter);
    if (ratingFilter === "5") list = list.filter(r => r.rating === 5);
    else if (ratingFilter === "4") list = list.filter(r => r.rating === 4);
    else if (ratingFilter === "below3") list = list.filter(r => r.rating <= 3);
    return list;
  }, [reviews, ratingFilter, barberFilter]);

  const sendReply = async (id: string) => {
    if (!replyText.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("reviews").update({ reply: replyText.trim() }).eq("id", id);
    if (!error) {
      setReviews(prev => prev.map(r => r.id === id ? { ...r, reply: replyText.trim() } : r));
      showToast("Reply sent!");
      setReplyingTo(null);
      setReplyText("");
    } else showToast("Error: " + error.message);
    setSaving(false);
  };

  if (!shop) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-2xl mb-2">⭐</p>
        <h2 className="text-lg font-bold text-white mb-1">No shop linked</h2>
        <p className="text-sm text-[#777]">Reviews will appear here once your shop is active.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div>
        <h1 className="text-2xl font-bold text-white">Reviews</h1>
        <p className="text-sm text-[#777] mt-0.5">Monitor and respond to client feedback</p>
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 gap-6">
          {[1,2].map(i => <div key={i} className="h-44 rounded-2xl bg-[#141414] animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* Rating Overview */}
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardContent>
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-6xl font-bold text-black">{avgRating}</p>
                    <Stars rating={Math.round(Number(avgRating))} size="lg" />
                    <p className="text-xs text-[#777] mt-1">{reviews.length} review{reviews.length !== 1 ? "s" : ""}</p>
                  </div>
                  <div className="flex-1 space-y-2">
                    {ratingBreakdown.map(r => (
                      <div key={r.stars} className="flex items-center gap-2">
                        <span className="text-xs text-[#777] w-4">{r.stars}★</span>
                        <div className="flex-1 h-2 rounded-full bg-[#141414] overflow-hidden">
                          <div className="h-full bg-gold rounded-full transition-all"
                            style={{ width: reviews.length > 0 ? `${(r.count / reviews.length) * 100}%` : "0%" }} />
                        </div>
                        <span className="text-xs text-[#777] w-3">{r.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Response Rate</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm text-[#777]">Replied to reviews</p>
                      <p className="text-xl font-bold text-black">{replied.length} / {reviews.length}</p>
                    </div>
                    <div className="w-full h-3 rounded-full bg-[#141414] overflow-hidden">
                      <div className="h-full bg-gold rounded-full" style={{ width: reviews.length > 0 ? `${(replied.length / reviews.length) * 100}%` : "0%" }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="p-3 bg-[#141414] rounded-xl">
                      <p className="text-lg font-bold text-emerald-400">{reviews.filter(r => r.rating >= 4).length}</p>
                      <p className="text-xs text-[#777]">Positive</p>
                    </div>
                    <div className="p-3 bg-[#141414] rounded-xl">
                      <p className="text-lg font-bold text-orange-400">{reviews.filter(r => r.rating === 3).length}</p>
                      <p className="text-xs text-[#777]">Neutral</p>
                    </div>
                    <div className="p-3 bg-[#141414] rounded-xl">
                      <p className="text-lg font-bold text-red-400">{reviews.filter(r => r.rating <= 2).length}</p>
                      <p className="text-xs text-[#777]">Negative</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="flex rounded-xl border border-[#1e1e1e] overflow-hidden">
              {[["all","All"],["5","5★"],["4","4★"],["below3","Below 3★"]].map(([v,l]) => (
                <button key={v} onClick={() => setRatingFilter(v)}
                  className={cn("px-3 py-2 text-sm font-medium transition-colors", ratingFilter === v ? "bg-gold text-black" : "text-[#777] hover:text-white bg-[#141414]")}>
                  {l}
                </button>
              ))}
            </div>
            {barbers.length > 0 && (
              <select value={barberFilter} onChange={e => setBarberFilter(e.target.value)}
                className="rounded-xl border border-[#1e1e1e] bg-[#141414] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-black/20">
                <option value="all">All Barbers</option>
                {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <span className="text-sm text-[#777] self-center">{filtered.length} review{filtered.length !== 1 ? "s" : ""}</span>
          </div>

          {/* Reviews List */}
          <div className="space-y-4">
            {filtered.length === 0 ? (
              <Card>
                <div className="text-center py-12">
                  <p className="text-4xl mb-3">⭐</p>
                  <p className="text-[#777]">{reviews.length === 0 ? "No reviews yet. Reviews will appear here when clients rate their experience." : "No reviews match your filters."}</p>
                </div>
              </Card>
            ) : filtered.map(review => (
              <Card key={review.id}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-black/10 flex items-center justify-center text-black font-bold text-sm">
                      {(review.client_name ?? "?").split(" ").map(n => n[0]).join("").slice(0, 2)}
                    </div>
                    <div>
                      <p className="text-white font-semibold">{review.client_name ?? "Anonymous"}</p>
                      <p className="text-xs text-[#777]">
                        {barbers.find(b => b.id === review.barber_id)?.name ?? "Shop"} · {review.created_at.split("T")[0]}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {review.reply && <Badge variant="success">Responded</Badge>}
                    <Stars rating={review.rating} />
                  </div>
                </div>

                {review.comment && <p className="text-sm text-[#999] leading-relaxed mb-3">&ldquo;{review.comment}&rdquo;</p>}

                {review.reply && (
                  <div className="p-3 bg-[#141414] rounded-xl border border-[#1e1e1e] mb-3">
                    <p className="text-xs text-black mb-1">Your reply:</p>
                    <p className="text-sm text-[#999]">{review.reply}</p>
                  </div>
                )}

                <div className="flex gap-2">
                  {!review.reply ? (
                    <Button variant="outline" size="sm" onClick={() => { setReplyingTo(replyingTo === review.id ? null : review.id); setReplyText(""); }}>
                      {replyingTo === review.id ? "Cancel" : "Reply"}
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" className="text-[#777]" onClick={() => { setReplyingTo(replyingTo === review.id ? null : review.id); setReplyText(review.reply ?? ""); }}>
                      Edit Reply
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => showToast("Link copied!")}>Share</Button>
                </div>

                {replyingTo === review.id && (
                  <div className="mt-4 space-y-2">
                    <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                      placeholder="Write a reply to this review..."
                      className="w-full rounded-xl border border-[#1e1e1e] bg-[#141414] px-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:ring-2 focus:ring-black/20 resize-none"
                      rows={3} />
                    <Button size="sm" loading={saving} onClick={() => sendReply(review.id)}>Send Reply</Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
