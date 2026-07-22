"use client";
import { useState, useEffect, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Star, Check, Scissors } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { cn, prettyDate } from "@/lib/utils";

interface AppointmentInfo {
  id: string;
  client_name: string;
  client_email: string;
  date: string;
  time_slot: string;
  shop_id: string;
  barber_id: string | null;
  service_id: string | null;
  barbers: { name: string } | null;
  services: { name: string } | null;
  shops: { name: string; slug: string } | null;
}

function ReviewContent({ shopslug }: { shopslug: string }) {
  const searchParams = useSearchParams();
  const bookingId = searchParams?.get("booking");

  const [loading, setLoading] = useState(true);
  const [appt, setAppt] = useState<AppointmentInfo | null>(null);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!bookingId) { setNotFound(true); setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from("appointments")
        .select("id, client_name, client_email, date, time_slot, shop_id, barber_id, service_id, barbers(name), services(name), shops(name, slug)")
        .eq("id", bookingId)
        .single();

      if (!data) { setNotFound(true); setLoading(false); return; }

      const apptData = data as unknown as AppointmentInfo;

      // Verify slug matches
      if (apptData.shops?.slug !== shopslug) { setNotFound(true); setLoading(false); return; }

      // Check if already reviewed
      const { data: existingReview } = await supabase
        .from("reviews")
        .select("id")
        .eq("shop_id", apptData.shop_id)
        .eq("client_id", bookingId)
        .maybeSingle();

      if (existingReview) { setAlreadyReviewed(true); }
      setAppt(apptData);
      setLoading(false);
    })();
  }, [bookingId, shopslug]);

  const submitReview = async () => {
    if (!appt || rating === 0) return;
    setSubmitting(true);
    setError("");
    // Submit via the service-role API — anon RLS blocks a direct reviews insert.
    try {
      const res = await fetch("/api/reviews/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: bookingId, shopslug, rating, comment }),
      });
      const data = await res.json();
      setSubmitting(false);
      if (!data.ok) { setError(data.error || "Could not submit your review. Please try again."); return; }
      if (data.alreadyReviewed) setAlreadyReviewed(true);
      else setSubmitted(true);
    } catch {
      setSubmitting(false);
      setError("Connection error. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !appt) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
        <Logo size="md" className="justify-center mb-8" />
        <div className="bg-surface border border-border rounded-2xl p-8 max-w-sm">
          <Scissors size={40} className="text-[#999] mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Review Link Invalid</h1>
          <p className="text-[#6e6e6e] text-sm">This review link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  if (submitted || alreadyReviewed) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
        <Logo size="md" className="justify-center mb-8" />
        <div className="bg-surface border border-emerald-500/30 rounded-2xl p-8 max-w-sm">
          <div className="w-16 h-16 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check size={32} className="text-emerald-400" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">
            {submitted ? "Thanks for your review!" : "Already reviewed"}
          </h1>
          <p className="text-[#6e6e6e] text-sm">
            {submitted
              ? `Your feedback for ${appt.shops?.name} has been submitted.`
              : "You've already left a review for this appointment."
            }
          </p>
          {submitted && (
            <div className="flex justify-center gap-1 mt-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} size={20} className={cn("text-amber-400", i < rating ? "fill-amber-400" : "")} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const displayRating = hoverRating || rating;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <Logo size="md" className="justify-center mb-8" />

        <div className="bg-surface border border-border rounded-2xl p-6 space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-gold/15 border border-gold/30 flex items-center justify-center mx-auto mb-4">
              <Scissors size={28} className="text-gold" />
            </div>
            <h1 className="text-xl font-bold text-white">{appt.shops?.name}</h1>
            <p className="text-[#6e6e6e] text-sm mt-1">How was your visit, {appt.client_name}?</p>
          </div>

          {/* Appointment summary */}
          <div className="bg-surface-raised rounded-xl p-4 space-y-1.5 text-sm">
            {appt.barbers?.name && (
              <div className="flex justify-between">
                <span className="text-[#8f8f8f]">Barber</span>
                <span className="text-white">{appt.barbers.name}</span>
              </div>
            )}
            {appt.services?.name && (
              <div className="flex justify-between">
                <span className="text-[#8f8f8f]">Service</span>
                <span className="text-white">{appt.services.name}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-[#8f8f8f]">Date</span>
              <span className="text-white">{prettyDate(appt.date)}</span>
            </div>
          </div>

          {/* Star rating */}
          <div>
            <p className="text-sm font-medium text-white text-center mb-3">Rate your experience</p>
            <div className="flex justify-center gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <button
                  key={i}
                  onMouseEnter={() => setHoverRating(i + 1)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(i + 1)}
                  className="transition-transform hover:scale-110"
                >
                  <Star
                    size={36}
                    className={cn(
                      "transition-colors",
                      i < displayRating ? "text-amber-400 fill-amber-400" : "text-[#999]"
                    )}
                  />
                </button>
              ))}
            </div>
            {displayRating > 0 && (
              <p className="text-center text-sm text-[#6e6e6e] mt-2">
                {["", "Poor", "Fair", "Good", "Great", "Excellent!"][displayRating]}
              </p>
            )}
          </div>

          {/* Comment */}
          <div>
            <label className="text-sm font-medium text-gray-300 block mb-1.5">
              Leave a comment <span className="text-[#8f8f8f] font-normal">(optional)</span>
            </label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Tell others about your experience..."
              className="w-full bg-surface-raised border border-border rounded-xl px-4 py-3 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-gold/50 resize-none"
            />
            <p className="text-xs text-[#999] mt-1 text-right">{comment.length}/500</p>
          </div>

          <Button
            className="w-full"
            disabled={rating === 0}
            loading={submitting}
            onClick={submitReview}
          >
            {rating === 0 ? "Select a rating to continue" : "Submit Review"}
          </Button>
          {error && <p className="text-center text-sm text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const params = useParams();
  const shopslug = params?.shopslug as string;
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
    }>
      <ReviewContent shopslug={shopslug} />
    </Suspense>
  );
}
