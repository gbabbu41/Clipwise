"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Star, Check, Scissors, CalendarClock } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { cn, prettyDate, formatDateForDb, timeToMinutes } from "@/lib/utils";

interface AppointmentInfo {
  id: string;
  client_name: string;
  date: string;
  time_slot: string;
  status: string | null;
  shop_id: string;
  barber_id: string | null;
  service_id: string | null;
  barbers: { name: string } | null;
  services: { name: string } | null;
  shops: { name: string; slug: string } | null;
}

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Great", "Excellent!"];

// A visit is reviewable once it has actually happened: the shop marked it
// completed/no-show/cancelled, or its start time is in the past. Blocks a review
// on a booking that hasn't happened yet (a review link opened too early).
function hasHappened(a: AppointmentInfo): boolean {
  if (a.status === "completed" || a.status === "no-show" || a.status === "cancelled") return true;
  const today = formatDateForDb(new Date());
  if (a.date < today) return true;
  if (a.date > today) return false;
  const now = new Date();
  return timeToMinutes(a.time_slot) <= now.getHours() * 60 + now.getMinutes();
}

function ReviewContent({ shopslug }: { shopslug: string }) {
  const searchParams = useSearchParams();
  const bookingId = searchParams?.get("booking");

  const [loading, setLoading] = useState(true);
  const [appt, setAppt] = useState<AppointmentInfo | null>(null);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!bookingId) { setNotFound(true); setLoading(false); return; }
    setLoading(true); setNotFound(false); setLoadError(false);
    // Load via the service-role API — appointments RLS is stakeholder-only, so a
    // direct anon query always returned null and made this page a dead "invalid
    // link" for EVERY customer. The endpoint also returns the already-reviewed
    // flag and distinguishes a real miss (404) from a transient error (retry).
    try {
      const res = await fetch(`/api/reviews/appointment?booking=${encodeURIComponent(bookingId)}&shopslug=${encodeURIComponent(shopslug)}`);
      if (res.status === 404) { setNotFound(true); setLoading(false); return; }
      if (!res.ok) { setLoadError(true); setLoading(false); return; }
      const data = await res.json();
      if (!data?.appointment) { setNotFound(true); setLoading(false); return; }
      if (data.alreadyReviewed) setAlreadyReviewed(true);
      setAppt(data.appointment as AppointmentInfo);
    } catch {
      setLoadError(true);
    }
    setLoading(false);
  }, [bookingId, shopslug]);

  useEffect(() => { load(); }, [load]);

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
        <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
        <Logo size="md" className="justify-center mb-8" />
        <div className="bg-card border border-border rounded-2xl p-8 max-w-sm">
          <Scissors size={40} className="text-grey mx-auto mb-4" />
          <h1 className="text-xl font-bold text-foreground mb-2">Couldn&apos;t load this page</h1>
          <p className="text-grey text-sm mb-4">Check your connection and try again.</p>
          <Button className="bg-emerald-500 hover:bg-emerald-600 text-black" onClick={() => load()}>Try again</Button>
        </div>
      </div>
    );
  }

  if (notFound || !appt) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
        <Logo size="md" className="justify-center mb-8" />
        <div className="bg-card border border-border rounded-2xl p-8 max-w-sm">
          <Scissors size={40} className="text-grey mx-auto mb-4" />
          <h1 className="text-xl font-bold text-foreground mb-2">Review link invalid</h1>
          <p className="text-grey text-sm">This review link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  if (submitted || alreadyReviewed) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
        <Logo size="md" className="justify-center mb-8" />
        <div className="bg-card border border-emerald-500/30 rounded-2xl p-8 max-w-sm">
          <div className="w-16 h-16 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check size={32} className="text-emerald-400" />
          </div>
          <h1 className="text-xl font-bold text-foreground mb-2">
            {submitted ? "Thanks for your review!" : "Already reviewed"}
          </h1>
          <p className="text-grey text-sm">
            {submitted
              ? `Your feedback for ${appt.shops?.name} has been submitted.`
              : "You've already left a review for this appointment — thank you!"}
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

  // Booking hasn't happened yet — let them know they can review after the visit,
  // rather than rating a service that hasn't been given.
  if (!hasHappened(appt)) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
        <Logo size="md" className="justify-center mb-8" />
        <div className="bg-card border border-border rounded-2xl p-8 max-w-sm">
          <div className="w-16 h-16 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
            <CalendarClock size={30} className="text-emerald-400" />
          </div>
          <h1 className="text-xl font-bold text-foreground mb-2">You&rsquo;re all booked!</h1>
          <p className="text-grey text-sm">
            Your appointment with {appt.shops?.name} is on {prettyDate(appt.date)} at {appt.time_slot}.
            Come back here after your visit to leave a review.
          </p>
        </div>
      </div>
    );
  }

  const displayRating = hoverRating || rating;
  const initial = (appt.shops?.name ?? "?").charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <Logo size="md" className="justify-center mb-8" />

        <div className="bg-card border border-border rounded-2xl p-6 space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4 text-emerald-400 text-2xl font-extrabold">
              {initial}
            </div>
            <h1 className="text-xl font-bold text-foreground">{appt.shops?.name}</h1>
            <p className="text-grey text-sm mt-1">How was your visit, {appt.client_name}?</p>
          </div>

          {/* Appointment summary */}
          <div className="bg-card-raised rounded-xl p-4 space-y-1.5 text-sm">
            {appt.barbers?.name && (
              <div className="flex justify-between">
                <span className="text-grey">Barber</span>
                <span className="text-foreground font-medium">{appt.barbers.name}</span>
              </div>
            )}
            {appt.services?.name && (
              <div className="flex justify-between">
                <span className="text-grey">Service</span>
                <span className="text-foreground font-medium">{appt.services.name}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-grey">Date</span>
              <span className="text-foreground font-medium">{prettyDate(appt.date)}</span>
            </div>
          </div>

          {/* Star rating */}
          <div>
            <p className="text-sm font-medium text-foreground text-center mb-3">Rate your experience</p>
            <div className="flex justify-center gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`${i + 1} star${i ? "s" : ""}`}
                  onMouseEnter={() => setHoverRating(i + 1)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(i + 1)}
                  className="transition-transform hover:scale-110 active:scale-95 p-0.5"
                >
                  <Star
                    size={38}
                    className={cn(
                      "transition-colors",
                      i < displayRating ? "text-amber-400 fill-amber-400" : "text-grey-muted",
                    )}
                  />
                </button>
              ))}
            </div>
            <p className="text-center text-sm text-grey mt-2 min-h-[1.25rem]">
              {displayRating > 0 ? RATING_WORDS[displayRating] : "Tap a star"}
            </p>
          </div>

          {/* Comment */}
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">
              Leave a comment <span className="text-grey font-normal">(optional)</span>
            </label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Tell others about your experience…"
              className="w-full bg-card-raised border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-emerald-500/50 resize-none"
            />
            <p className="text-xs text-grey mt-1 text-right">{comment.length}/500</p>
          </div>

          <Button
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-black disabled:opacity-50"
            disabled={rating === 0}
            loading={submitting}
            onClick={submitReview}
          >
            {rating === 0 ? "Select a rating to continue" : "Submit review"}
          </Button>
          {error && <p className="text-center text-sm text-red-400">{error}</p>}
        </div>

        <p className="text-center text-xs text-grey-muted mt-5">Powered by ClipWise</p>
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
        <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    }>
      <ReviewContent shopslug={shopslug} />
    </Suspense>
  );
}
