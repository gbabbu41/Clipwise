"use client";
import { useState } from "react";
import Link from "next/link";
import { Search, Calendar, Clock, MapPin, Scissors, X, Check } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { cn, prettyDate } from "@/lib/utils";

interface BookingResult {
  id: string;
  date: string;
  time_slot: string;
  status: string;
  total_amount: number;
  client_name: string;
  client_email: string;
  shops: { name: string; slug: string; address: string; city: string; province: string } | null;
  barbers: { name: string } | null;
  services: { name: string } | null;
}

function StatusBadge({ status }: { status: string }) {
  const v = status === "confirmed" ? "success" : status === "completed" ? "info" : status === "pending" ? "warning" : "danger";
  return <Badge variant={v} className="capitalize text-xs">{status}</Badge>;
}

export default function MyBookingsPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [bookings, setBookings] = useState<BookingResult[]>([]);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const search = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setSearched(false);
    const { data } = await supabase
      .from("appointments")
      .select("id, date, time_slot, status, total_amount, client_name, client_email, shops(name, slug, address, city, province), barbers(name), services(name)")
      .eq("client_email", email.trim().toLowerCase())
      .order("date", { ascending: false })
      .limit(20);
    setBookings((data ?? []) as unknown as BookingResult[]);
    setSearched(true);
    setLoading(false);
  };

  const cancelBooking = async (id: string) => {
    setCancelling(true);
    const booking = bookings.find(b => b.id === id);
    await supabase.from("appointments").update({ status: "cancelled" }).eq("id", id);

    // Notify shop owner via in-app notification + email
    if (booking?.shops) {
      const { data: shopRow } = await supabase
        .from("shops")
        .select("owner_id, email, name")
        .eq("slug", booking.shops.slug)
        .single();
      if (shopRow?.owner_id) {
        supabase.from("notifications").insert({
          user_id: shopRow.owner_id,
          title: "Appointment Cancelled",
          message: `${booking.client_name} cancelled their ${booking.services?.name ?? "appointment"} on ${prettyDate(booking.date)} at ${booking.time_slot}`,
          type: "cancellation",
          is_read: false,
        }).then(null, () => null);

        // Email the shop owner
        if (shopRow.email) {
          fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "appointment_cancelled",
              data: {
                ownerEmail: shopRow.email,
                shopName: shopRow.name,
                clientName: booking.client_name,
                serviceName: booking.services?.name ?? "Appointment",
                date: booking.date,
                time: booking.time_slot,
                barberName: booking.barbers?.name ?? "—",
              },
            }),
          }).catch(() => null);
        }
      }
    }

    // Notify the assigned barber their slot is free again (fire-and-forget).
    fetch("/api/appointments/notify-cancellation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: id, statusLabel: "Cancelled" }),
    }).catch(() => null);

    // Smart waitlist: ping anyone waiting for this now-free day.
    fetch("/api/waitlist/slot-opened", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: id }),
    }).catch(() => null);

    setBookings(prev => prev.map(b => b.id === id ? { ...b, status: "cancelled" } : b));
    setCancelId(null);
    setCancelling(false);
  };

  const upcoming = bookings.filter(b => b.date >= new Date().toISOString().slice(0, 10) && !["cancelled", "completed"].includes(b.status));
  const past = bookings.filter(b => b.date < new Date().toISOString().slice(0, 10) || ["cancelled", "completed"].includes(b.status));

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-surface border-b border-border sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <Link href="/"><Logo size="sm" /></Link>
          <div className="flex gap-3">
            <Link href="/shops"><Button variant="outline" size="sm">Find a Barbershop</Button></Link>
            <Link href="/login"><Button size="sm">Sign In</Button></Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-surface border-b border-border py-10">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-gold/10 border border-gold/20 rounded-full px-4 py-1.5 text-gold text-sm font-medium mb-4">
            <Calendar size={14} /> My Bookings
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">Look Up Your Appointments</h1>
          <p className="text-[#555] text-sm mb-6">Enter the email address you used when booking to see your appointments.</p>

          <div className="max-w-md mx-auto flex gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777]" />
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && search()}
                type="email"
                placeholder="your@email.com"
                className="w-full bg-surface-raised border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-[#777] focus:outline-none focus:ring-2 focus:ring-gold/50"
              />
            </div>
            <Button loading={loading} onClick={search}>Search</Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {!searched && !loading && (
          <div className="text-center py-12 text-[#777]">
            <Scissors size={40} className="mx-auto mb-4 text-[#999]" />
            <p className="text-sm">Enter your email above to find your bookings</p>
          </div>
        )}

        {searched && bookings.length === 0 && (
          <div className="text-center py-12">
            <Scissors size={40} className="mx-auto mb-4 text-[#999]" />
            <h2 className="text-lg font-bold text-white mb-2">No bookings found</h2>
            <p className="text-[#777] text-sm">No appointments found for {email}.</p>
            <Link href="/shops" className="mt-4 inline-block">
              <Button className="mt-4">Find a Barbershop</Button>
            </Link>
          </div>
        )}

        {searched && bookings.length > 0 && (
          <div className="space-y-6">
            {/* Upcoming */}
            {upcoming.length > 0 && (
              <div>
                <h2 className="text-lg font-bold text-white mb-3">Upcoming ({upcoming.length})</h2>
                <div className="space-y-3">
                  {upcoming.map(b => (
                    <div key={b.id} className="bg-surface border border-border rounded-2xl p-5 hover:border-gold/30 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-white font-semibold">{b.shops?.name}</h3>
                            <StatusBadge status={b.status} />
                          </div>
                          <div className="flex flex-wrap gap-4 text-sm text-[#555]">
                            <span className="flex items-center gap-1"><Calendar size={13} />{prettyDate(b.date)}</span>
                            <span className="flex items-center gap-1"><Clock size={13} />{b.time_slot}</span>
                            {b.shops && (
                              <span className="flex items-center gap-1"><MapPin size={13} />{b.shops.city}, {b.shops.province}</span>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-[#777]">
                            {b.services?.name && <span>Service: <span className="text-gray-300">{b.services.name}</span></span>}
                            {b.barbers?.name && <span>Barber: <span className="text-gray-300">{b.barbers.name}</span></span>}
                            <span>Total: <span className="text-gold font-medium">${Number(b.total_amount).toFixed(2)}</span></span>
                          </div>
                          <p className="text-xs text-[#999] mt-1">Booking #{b.id.slice(0, 8).toUpperCase()}</p>
                        </div>
                        <div className="flex flex-col gap-2">
                          {b.shops?.slug && (
                            <Link href={`/book/${b.shops.slug}`}>
                              <Button variant="outline" size="sm">Rebook</Button>
                            </Link>
                          )}
                          {b.status !== "cancelled" && (
                            <Button variant="danger" size="sm" onClick={() => setCancelId(b.id)}>Cancel</Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Past */}
            {past.length > 0 && (
              <div>
                <h2 className="text-lg font-bold text-white mb-3">Past Appointments</h2>
                <div className="space-y-3">
                  {past.map(b => (
                    <div key={b.id} className={cn("bg-surface border border-border rounded-2xl p-5 opacity-70")}>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-white font-semibold">{b.shops?.name}</h3>
                            <StatusBadge status={b.status} />
                          </div>
                          <div className="flex flex-wrap gap-4 text-sm text-[#555]">
                            <span className="flex items-center gap-1"><Calendar size={13} />{prettyDate(b.date)}</span>
                            <span className="flex items-center gap-1"><Clock size={13} />{b.time_slot}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-[#777]">
                            {b.services?.name && <span>Service: <span className="text-gray-300">{b.services.name}</span></span>}
                            {b.barbers?.name && <span>Barber: <span className="text-gray-300">{b.barbers.name}</span></span>}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          {b.shops?.slug && b.status === "completed" && (
                            <Link href={`/book/${b.shops.slug}/review?booking=${b.id}`}>
                              <Button variant="outline" size="sm">Leave Review</Button>
                            </Link>
                          )}
                          {b.shops?.slug && (
                            <Link href={`/book/${b.shops.slug}`}>
                              <Button variant="ghost" size="sm">Book Again</Button>
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cancel Confirmation Modal */}
      {cancelId && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setCancelId(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-sm space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-red-500/15 rounded-full flex items-center justify-center">
                  <X size={20} className="text-red-400" />
                </div>
                <h2 className="text-lg font-bold text-white">Cancel Appointment?</h2>
              </div>
              <p className="text-sm text-[#555]">This will cancel your appointment. Please contact the shop if you need to reschedule.</p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setCancelId(null)}>Keep It</Button>
                <Button variant="danger" className="flex-1" loading={cancelling} onClick={() => cancelBooking(cancelId)}>
                  <X size={14} /> Cancel Booking
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
