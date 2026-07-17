"use client";
import Link from "next/link";
import { Calendar, Mail, MessageSquare, Search } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";

// Customers manage a booking through the unguessable per-booking link (the
// appointment UUID) sent in their confirmation email/SMS — not an email lookup.
// appointments RLS is stakeholder-only, so an anon email search returns nothing
// and would only mislead. This page points customers at that link instead.
export default function MyBookingsPage() {
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

      <div className="max-w-lg mx-auto px-4 py-16">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-gold/10 border border-gold/20 rounded-full px-4 py-1.5 text-gold text-sm font-medium mb-4">
            <Calendar size={14} /> My Bookings
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Manage Your Appointment</h1>
          <p className="text-[#777] text-sm">
            Every booking confirmation includes a secure link to view, reschedule,
            or cancel that appointment — no sign-in needed.
          </p>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-gold/10 flex items-center justify-center flex-shrink-0">
              <Mail size={16} className="text-gold" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Check your email</p>
              <p className="text-xs text-[#777] mt-0.5">
                Open your booking confirmation and tap <span className="text-gray-300">&ldquo;View / Manage Booking&rdquo;</span> to make changes.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-gold/10 flex items-center justify-center flex-shrink-0">
              <MessageSquare size={16} className="text-gold" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Or your text message</p>
              <p className="text-xs text-[#777] mt-0.5">
                If you booked with a phone number, the same link is in your confirmation SMS.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 bg-surface/60 border border-border rounded-2xl p-5 text-center">
          <Search size={22} className="mx-auto mb-2 text-[#999]" />
          <p className="text-sm text-white font-medium mb-1">Can&apos;t find your link?</p>
          <p className="text-xs text-[#777] mb-4">
            Contact the barbershop directly and they can look up or update your appointment for you.
          </p>
          <Link href="/shops">
            <Button variant="outline" size="sm">Find a Barbershop</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
