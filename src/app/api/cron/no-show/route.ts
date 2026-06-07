import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getTwilio, twilioSender, toE164 } from "@/lib/twilio";

// POST /api/cron/no-show  (run every ~30 min; needs x-cron-secret)
// Auto-charges the held card for appointments a client didn't show up to
// (still pending/confirmed ~2h after their time) when the shop has no-show
// protection on, then SMSes the client. Never throws — bad rows are skipped.
const GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours after the slot

function slotToDate(date: string, slot: string): Date | null {
  const m = slot?.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  const d = new Date(`${date}T${String(h).padStart(2, "0")}:${m[2]}:00`);
  return isNaN(d.getTime()) ? null : d;
}

// Accept Vercel Cron (GET + Authorization: Bearer CRON_SECRET) and external
// schedulers (POST + x-cron-secret).
function authorized(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET;
  if (!s) return true; // unset = allow (local dev)
  return req.headers.get("x-cron-secret") === s || req.headers.get("authorization") === `Bearer ${s}`;
}

async function run() {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Open appointments with a card still on hold, dated today or earlier.
  const { data: rows } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, client_name, client_phone, date, time_slot, total_amount, payment_intent_id")
    .eq("payment_status", "held")
    .in("status", ["pending", "confirmed"])
    .lte("date", today);
  const appts = rows ?? [];
  if (appts.length === 0) return NextResponse.json({ ok: true, charged: 0, skipped: 0 });

  // Load each shop's settings + Connect info once.
  const shopIds = Array.from(new Set(appts.map(a => a.shop_id)));
  const { data: shops } = await supabaseAdmin
    .from("shops").select("id, name, booking_settings, stripe_account_id, stripe_connected").in("id", shopIds);
  const shopMap = new Map((shops ?? []).map(s => [s.id, s]));

  const twilio = getTwilio();
  const sender = twilioSender();
  let charged = 0, skipped = 0;

  for (const a of appts) {
    const shop = shopMap.get(a.shop_id);
    const bs = (shop?.booking_settings ?? null) as { no_show_protection?: boolean; no_show_fee_amount?: number } | null;
    if (!shop || !bs?.no_show_protection || !a.payment_intent_id) { skipped++; continue; }

    const dt = slotToDate(a.date, a.time_slot);
    if (!dt || dt.getTime() + GRACE_MS > now) { skipped++; continue; } // not yet past the grace window

    const feeDollars = bs.no_show_fee_amount ?? 0;
    const feeCents = feeDollars > 0
      ? Math.min(Math.round(feeDollars * 100), Math.round((a.total_amount ?? 0) * 100))
      : 0;
    const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);
    const opts = useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined;

    try {
      const pi = await stripe.paymentIntents.capture(a.payment_intent_id, feeCents > 0 ? { amount_to_capture: feeCents } : {}, opts);
      await supabaseAdmin.from("appointments")
        .update({ status: "no-show", payment_status: "captured", payment_method: "card" }).eq("id", a.id);
      await supabaseAdmin.from("appointments")
        .update({ no_show_fee_amount: pi.amount_received ?? null }).eq("id", a.id).then(null, () => null);

      // SMS the client (best-effort).
      const to = toE164(a.client_phone);
      if (twilio && sender && to) {
        const amt = ((pi.amount_received ?? 0) / 100).toFixed(2);
        twilio.messages.create({
          ...sender, to,
          body: `Hi ${a.client_name}, you missed your appointment at ${shop.name} on ${a.date}. A no-show fee of $${amt} has been charged. — ClipWise`,
        }).then(null, () => null);
      }
      charged++;
    } catch {
      await supabaseAdmin.from("appointments").update({ payment_status: "failed" }).eq("id", a.id).then(null, () => null);
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, charged, skipped });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run();
}
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run();
}
