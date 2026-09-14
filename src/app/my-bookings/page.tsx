import Link from "next/link";
import { Calendar, Mail, MessageSquare, Search } from "lucide-react";
import { MKT_CSS } from "@/lib/marketing-theme";

// Customers manage a booking through the unguessable per-booking link (the
// appointment UUID) sent in their confirmation email/SMS — not an email lookup.
// appointments RLS is stakeholder-only, so an anon email search returns nothing
// and would only mislead. This page points customers at that link instead.
export default function MyBookingsPage() {
  return (
    <div className="mkt">
      <style dangerouslySetInnerHTML={{ __html: MKT_CSS }} />

      <header style={{ position: "sticky", top: 0, zIndex: 30, background: "rgba(8,8,10,.7)", backdropFilter: "blur(18px)", borderBottom: "1px solid var(--line)" }}>
        <div className="wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <Link href="/" className="brand" style={{ fontWeight: 800, letterSpacing: "-.045em", fontSize: 16, color: "var(--t1)" }}>CLIPWISE</Link>
          <div style={{ display: "flex", gap: 10 }}>
            <Link href="/shops" className="pill g" style={{ padding: "8px 16px", fontSize: 13.5 }}>Find a Barber</Link>
            <Link href="/login" className="pill w" style={{ padding: "8px 16px", fontSize: 13.5 }}>Sign in</Link>
          </div>
        </div>
      </header>

      <section className="blk" style={{ paddingTop: "clamp(48px,8vw,80px)" }}>
        <div className="wrap" style={{ maxWidth: 520 }}>
          <div className="center" style={{ marginBottom: 28 }}>
            <span className="badge-warn" style={{ color: "var(--t1)", background: "rgba(255,255,255,.06)", borderColor: "rgba(255,255,255,.16)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Calendar size={14} /> My bookings
            </span>
            <h1 style={{ fontSize: "clamp(24px,4vw,32px)", fontWeight: 700, letterSpacing: "-.03em", margin: "14px 0 8px" }}>Manage your appointment</h1>
            <p className="lead" style={{ textAlign: "center" }}>Every booking confirmation includes a secure link to view, reschedule, or cancel that appointment — no sign-in needed.</p>
          </div>

          <div className="scard" style={{ transform: "none", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div className="logo-fb" style={{ width: 38, height: 38, borderRadius: 12 }}><Mail size={16} style={{ color: "var(--t1)" }} /></div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--t1)", margin: 0 }}>Check your email</p>
                <p style={{ fontSize: 12.5, color: "var(--t3)", margin: "3px 0 0" }}>Open your booking confirmation and tap “View / Manage Booking” to make changes.</p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div className="logo-fb" style={{ width: 38, height: 38, borderRadius: 12 }}><MessageSquare size={16} style={{ color: "var(--t1)" }} /></div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--t1)", margin: 0 }}>Or your text message</p>
                <p style={{ fontSize: 12.5, color: "var(--t3)", margin: "3px 0 0" }}>If you booked with a phone number, the same link is in your confirmation SMS.</p>
              </div>
            </div>
          </div>

          <div className="scard" style={{ transform: "none", textAlign: "center", marginTop: 16 }}>
            <Search size={22} style={{ color: "var(--t3)", margin: "0 auto 8px" }} />
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--t1)", margin: 0 }}>Can&rsquo;t find your link?</p>
            <p style={{ fontSize: 12.5, color: "var(--t3)", margin: "6px 0 16px" }}>Contact the barbershop directly and they can look up or update your appointment for you.</p>
            <Link href="/shops" className="pill g">Find a Barber</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
