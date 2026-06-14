import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSmsBestEffort } from "@/lib/twilio";
import { UNIQUE_VIOLATION, barberHasConflict } from "@/lib/booking-conflict";
import { timeToMinutes } from "@/lib/utils";

// Called when the customer returns from a paid booking checkout.
// Verifies payment on the connected account, then creates the appointment (idempotent).
export async function POST(request: NextRequest) {
  const { session_id, shop_id } = await request.json() as { session_id: string; shop_id: string };
  if (!session_id || !shop_id) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("stripe_account_id, stripe_connected").eq("id", shop_id).single();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);

  try {
    const session = await stripe.checkout.sessions.retrieve(
      session_id,
      undefined,
      useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined,
    );
    const acctOpts = useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined;
    const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
    const m = session.metadata ?? {};
    const isHold = m.hold === "1";
    const isSave = m.save === "1";

    // Saved-card path (>7 day booking): the session is `setup` mode — no charge.
    // Confirm the SetupIntent succeeded and grab the Customer + saved card so we
    // can charge off-session on completion / no-show.
    let savedCustomerId: string | null = null;
    let savedPaymentMethodId: string | null = null;
    if (isSave) {
      const setupIntentId = typeof session.setup_intent === "string" ? session.setup_intent : null;
      if (!setupIntentId) return NextResponse.json({ paid: false }, { status: 200 });
      const si = await stripe.setupIntents.retrieve(setupIntentId, undefined, acctOpts);
      if (si.status !== "succeeded") return NextResponse.json({ paid: false }, { status: 200 });
      savedCustomerId = typeof si.customer === "string" ? si.customer : null;
      savedPaymentMethodId = typeof si.payment_method === "string" ? si.payment_method : null;
      if (!savedPaymentMethodId) return NextResponse.json({ paid: false }, { status: 200 });
    } else if (isHold) {
      // A card hold leaves the session "unpaid" until capture — confirm the
      // PaymentIntent reached requires_capture (authorized). Otherwise require paid.
      if (!paymentIntentId) return NextResponse.json({ paid: false }, { status: 200 });
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId, undefined, acctOpts);
      if (pi.status !== "requires_capture") return NextResponse.json({ paid: false }, { status: 200 });
    } else if (session.payment_status !== "paid") {
      return NextResponse.json({ paid: false }, { status: 200 });
    }

    // Idempotency — don't double-create if this checkout already produced an
    // appointment. Paid/held rows dedupe on the PaymentIntent; saved-card rows
    // have no PI yet, so dedupe on the saved card + exact slot instead.
    if (paymentIntentId) {
      const { data: existing } = await supabaseAdmin
        .from("appointments").select("id").eq("payment_intent_id", paymentIntentId).maybeSingle();
      if (existing) return NextResponse.json({ paid: true, appointmentId: existing.id });
    } else if (isSave && savedPaymentMethodId) {
      const { data: existing } = await supabaseAdmin
        .from("appointments").select("id")
        .eq("stripe_payment_method_id", savedPaymentMethodId)
        .eq("date", m.date).eq("time_slot", m.time_slot).maybeSingle();
      if (existing) return NextResponse.json({ paid: true, appointmentId: existing.id });
    }

    // Duration-aware conflict re-check. The DB unique index only covers the
    // exact (barber, date, start-slot), so an overlap with a *longer* existing
    // appointment — or a slot grabbed between checkout and this finalize —
    // would slip through. Reverse the money rather than charge for a lost slot.
    if (m.barber_id) {
      const { data: fSvc } = await supabaseAdmin
        .from("services").select("duration_minutes").eq("id", m.service_id).maybeSingle();
      const fStart = timeToMinutes(m.time_slot);
      // Combined length for multi-service bookings (falls back to the primary
      // service duration) so the re-check reserves the whole block.
      const mDuration = Number(m.duration_minutes ?? 0) > 0 ? Number(m.duration_minutes) : (fSvc?.duration_minutes ?? 30);
      const fEnd = fStart + mDuration;
      if (await barberHasConflict(m.barber_id, m.date, fStart, fEnd)) {
        try {
          if (isHold && paymentIntentId) {
            await stripe.paymentIntents.cancel(paymentIntentId, undefined, acctOpts);
          } else if (!isHold && !isSave && paymentIntentId) {
            await stripe.refunds.create({ payment_intent: paymentIntentId }, acctOpts);
          }
        } catch { /* best-effort reversal — surface the conflict regardless */ }
        return NextResponse.json(
          { error: "That time was just booked by someone else. Your payment was reversed — please pick another slot." },
          { status: 409 },
        );
      }
    }

    const { data: appt, error } = await supabaseAdmin.from("appointments").insert({
      shop_id: m.shop_id,
      barber_id: m.barber_id || null,
      service_id: m.service_id,
      client_name: m.client_name,
      client_email: m.client_email,
      client_phone: m.client_phone,
      date: m.date,
      time_slot: m.time_slot,
      status: "confirmed",
      total_amount: Number(m.total_amount ?? 0),
      ...(Number(m.duration_minutes ?? 0) > 0 ? { duration_minutes: Number(m.duration_minutes) } : {}),
      ...(m.service_names ? { notes: `Services: ${m.service_names}` } : {}),
      deposit_paid: !isHold && !isSave,
      payment_status: isSave ? "saved" : isHold ? "held" : "paid",
      ...(!isSave && !isHold ? { paid_at: new Date().toISOString() } : {}),
      payment_intent_id: paymentIntentId,
      stripe_customer_id: savedCustomerId,
      stripe_payment_method_id: savedPaymentMethodId,
    }).select("id").single();

    if (error) {
      // Slot was taken in the race window between checkout and this finalize
      // (the DB unique index rejected it). The customer already paid/authorized,
      // so undo the money so they aren't charged for a slot they didn't get:
      //  · held (manual capture)  → cancel the authorization
      //  · paid                   → refund
      //  · saved (setup mode)     → nothing was charged
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        try {
          if (isHold && paymentIntentId) {
            await stripe.paymentIntents.cancel(paymentIntentId, undefined, acctOpts);
          } else if (!isHold && !isSave && paymentIntentId) {
            await stripe.refunds.create({ payment_intent: paymentIntentId }, acctOpts);
          }
        } catch { /* best-effort reversal — surface the conflict regardless */ }
        return NextResponse.json(
          { error: "That time was just booked by someone else. Your payment was reversed — please pick another slot." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Auto-register the customer in the shop's client book, deduped by
    // email → phone so a returning customer never doubles up.
    {
      const email = (m.client_email ?? "").trim();
      const phone = (m.client_phone ?? "").trim();
      let existingClient: { id: string } | null = null;
      if (email) {
        const { data } = await supabaseAdmin.from("clients").select("id").eq("shop_id", m.shop_id).ilike("email", email).maybeSingle();
        existingClient = data;
      }
      if (!existingClient && phone) {
        const { data } = await supabaseAdmin.from("clients").select("id").eq("shop_id", m.shop_id).eq("phone", phone).maybeSingle();
        existingClient = data;
      }
      if (!existingClient && m.client_name) {
        await supabaseAdmin.from("clients").insert({
          shop_id: m.shop_id, name: m.client_name, email, phone,
          total_visits: 0, total_spent: 0, loyalty_points: 0, tag: "New",
        }).then(null, () => null);
      }
    }

    // Notify the shop owner (fire-and-forget). Title carries the amount
    // so it's scannable at a glance ('New Paid Booking · $35'). Message
    // formats the raw YYYY-MM-DD date as 'July 6' for readability — we
    // don't use friendlyDate (Today/Tomorrow) here because the server's
    // clock is in UTC and would mis-label dates near the day boundary.
    const { data: shopRow } = await supabaseAdmin.from("shops").select("owner_id, name, email, slug").eq("id", m.shop_id).single();
    const dateObj = new Date(`${m.date}T00:00:00`);
    const friendly = dateObj.toLocaleDateString("en-CA", { month: "long", day: "numeric" });
    if (shopRow?.owner_id) {
      const amountStr = `$${Number(m.total_amount ?? 0).toFixed(0)}`;
      const bookingTitle = isSave ? `New Booking · card on file · ${amountStr}`
        : isHold ? `New Booking · card held · ${amountStr}`
        : `New Paid Booking · ${amountStr}`;
      const bookingVerb = isSave ? "(card saved)" : isHold ? "(card on hold)" : "& paid";
      supabaseAdmin.from("notifications").insert({
        user_id: shopRow.owner_id,
        title: bookingTitle,
        message: `${m.client_name} booked ${bookingVerb} for ${friendly} at ${m.time_slot}`,
        type: "booking",
        is_read: false,
      }).then(null, () => null);
    }

    // Barber in-app notification + SMS to owner & barber (server-side helper).
    // Drives the live portal pop-up + sound for the barber on paid bookings too.
    {
      const base = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      fetch(`${base}/api/appointments/notify-staff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: appt.id }),
      }).catch(() => null);
    }

    // Text the customer a confirmation (best-effort). Note reflects the
    // payment state so a held/saved card isn't mistaken for a charge.
    {
      const payNote = isSave ? " Card saved — charged after your visit."
        : isHold ? " Card held — charged after your visit."
        : " Paid online.";
      sendSmsBestEffort(
        m.client_phone,
        `Your appointment on ${friendly} at ${m.time_slot} is confirmed.${payNote} Booking #${appt.id.slice(0, 8).toUpperCase()}.`,
        shopRow?.name,
      );
    }

    // Booking-confirmation emails — customer + owner + assigned barber. Online
    // bookings skipped these before, so barbers/owners weren't being told.
    // Failures never block the booking.
    // Hoisted so the success-screen summary (returned below) can use the names —
    // the customer's in-memory booking state is wiped by the Stripe redirect.
    let summaryBarberName = "Any Available";
    let summaryServiceName = "Service";
    try {
      const [{ data: barber }, { data: service }] = await Promise.all([
        m.barber_id
          ? supabaseAdmin.from("barbers").select("name, email").eq("id", m.barber_id).maybeSingle()
          : Promise.resolve({ data: null as { name: string; email: string | null } | null }),
        m.service_id
          ? supabaseAdmin.from("services").select("name").eq("id", m.service_id).maybeSingle()
          : Promise.resolve({ data: null as { name: string } | null }),
      ]);
      summaryBarberName = barber?.name ?? "Any Available";
      summaryServiceName = service?.name ?? "Service";
      const base = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const bookingData = {
        clientName: m.client_name, clientEmail: m.client_email || "—", clientPhone: m.client_phone || "—",
        shopName: shopRow?.name ?? "", shopEmail: shopRow?.email ?? "", shopSlug: shopRow?.slug ?? "",
        barberName: barber?.name ?? "Any Available",
        serviceName: service?.name ?? "Service",
        date: m.date, time: m.time_slot,
        total: `$${Number(m.total_amount ?? 0).toFixed(2)}`,
        paymentNote: isSave ? "Card saved — charged after your visit"
          : isHold ? "Card on hold — charged after your visit"
          : "Paid online",
        bookingId: appt.id.slice(0, 8).toUpperCase(), appointmentId: appt.id,
      };
      const send = (type: string, extra: Record<string, unknown>) =>
        fetch(`${base}/api/send-email`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, data: { ...bookingData, ...extra } }),
        }).catch(() => null);
      if (m.client_email) send("booking_confirmation", { clientEmail: m.client_email });
      if (shopRow?.email) send("new_booking_owner", { ownerEmail: shopRow.email });
      if (barber?.email) send("new_booking_barber", { barberEmail: barber.email, barberName: barber.name });
    } catch { /* never block the booking on email */ }

    return NextResponse.json({
      paid: true,
      appointmentId: appt.id,
      // Summary for the confirmation screen — the customer's in-memory booking
      // state is gone after the redirect to/from Stripe, so the client renders
      // from this instead of showing blanks / $0.
      summary: {
        shopName: shopRow?.name ?? "",
        barberName: summaryBarberName,
        serviceName: summaryServiceName,
        date: m.date,
        time: m.time_slot,
        total: Number(m.total_amount ?? 0),
        clientEmail: m.client_email ?? "",
        paymentNote: isSave ? "Card saved — charged after your visit"
          : isHold ? "Card held — charged after your visit"
          : "Paid online",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
