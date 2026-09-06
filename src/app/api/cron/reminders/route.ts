import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSmsBestEffort } from "@/lib/twilio";
import { effectivePlan, isPaidPlan } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { prettyDate } from "@/lib/utils";
import { safeTz, todayInTz, shiftYmd, hoursUntilBooking } from "@/lib/timezone";
import { sendAppEmail } from "@/lib/emailer";
import { processTrials } from "@/lib/process-trials";
import { reconcileSubscriptions } from "@/lib/reconcile-subscriptions";

/**
 * Daily reminders + client auto-tagging. Runs once a day (Vercel cron, or an
 * external scheduler hitting it with x-cron-secret). Everything is idempotent
 * by construction — each condition matches a client/appointment on exactly one
 * calendar day — so a re-run on the same day won't double-send noticeably, and
 * there are no per-row "sent" flags to migrate.
 *
 * Per shop with a reminder toggled on (booking_settings.reminders) — on EVERY
 * plan, free Starter included. SMS is paid-plan only; email goes to all:
 *   • appointment_24h → email (all plans) + SMS (paid plans) for appts tomorrow
 *   • rebooking_30d   → email to clients whose last_visit was exactly 30 days ago
 *   • winback_60d     → email to clients whose last_visit was exactly 60 days ago
 *   • birthday        → email to clients whose birthday is today
 *
 * Auto-tagging runs for ALL shops regardless of plan/toggles (it's just
 * metadata that powers the marketing segments): VIP (10+ visits), At Risk
 * (no visit in 60+ days), Returning (2+ visits), else New.
 */
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca";
const MAX_SENDS = 300; // safety cap per run (Twilio trial / Resend limits)

function authorized(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET;
  if (!s) return process.env.NODE_ENV !== "production"; // unset = allow in local dev only; fail closed in prod
  return req.headers.get("x-cron-secret") === s || req.headers.get("authorization") === `Bearer ${s}`;
}

async function sendEmail(type: string, data: Record<string, unknown>) {
  // Send in-process (no HTTP hop, no shared secret) so cron reminders/nudges
  // never silently fail when CRON_SECRET isn't set. Coerce to the string map
  // the engine expects; drop nulls (same effect the JSON hop had).
  const strData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v != null) strData[k] = String(v);
  }
  await sendAppEmail(type, strData).then(null, () => null);
}

type ClientRow = {
  id: string; name: string; email: string | null; phone: string | null;
  total_visits: number | null; last_visit: string | null; tag: string | null;
  birthday?: string | null;
};

// New "at risk" / tier logic shared with the marketing segments.
function computeTag(c: ClientRow, todayMs: number): "New" | "Returning" | "VIP" | "At Risk" {
  const visits = c.total_visits ?? 0;
  const daysSince = c.last_visit ? Math.floor((todayMs - Date.parse(c.last_visit + "T00:00:00Z")) / 86400000) : Infinity;
  if (visits >= 1 && daysSince > 60) return "At Risk";
  if (visits >= 10) return "VIP";
  if (visits >= 2) return "Returning";
  return "New";
}

async function run() {
  await ensurePlansHydrated();

  const { data: shops } = await supabaseAdmin
    .from("shops")
    .select("id, name, email, slug, subscription_plan, subscription_status, booking_settings, timezone");
  if (!shops?.length) return NextResponse.json({ ok: true, shops: 0 });

  let emails = 0, texts = 0, retagged = 0, sends = 0;

  for (const shop of shops) {
    // All "which calendar day" math is done in the SHOP's timezone, so a shop
    // never gets tomorrow's reminders a day early/late regardless of when (in
    // UTC) the cron fires.
    const tz = safeTz((shop as { timezone?: string }).timezone ?? null);
    const today = todayInTz(tz);
    const todayMs = Date.parse(today + "T00:00:00Z");
    const tomorrow = shiftYmd(today, 1);
    const d30 = shiftYmd(today, -30);
    const d60 = shiftYmd(today, -60);
    const todayMMDD = today.slice(5); // "MM-DD"

    // ── Auto-tagging (all shops) ────────────────────────────────────────────
    const { data: clients } = await supabaseAdmin
      .from("clients").select("*").eq("shop_id", shop.id);
    const list = (clients ?? []) as ClientRow[];
    for (const c of list) {
      const next = computeTag(c, todayMs);
      if (next !== c.tag) {
        await supabaseAdmin.from("clients").update({ tag: next }).eq("id", c.id).then(null, () => null);
        c.tag = next;
        retagged++;
      }
    }

    // ── Reminders (per-toggle gated) ────────────────────────────────────────
    // Reminders reach EVERY shop, including the free Starter plan — by EMAIL.
    // SMS (Twilio, a real per-message cost) stays a paid-plan perk, so a free
    // shop gets email reminders and no texts.
    const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
    const smsAllowed = isPaidPlan(plan);
    const reminders = (shop.booking_settings as { reminders?: Record<string, boolean> } | null)?.reminders ?? {};
    const bookingUrl = `${BASE_URL}/book/${shop.slug ?? ""}`;

    // 24h appointment reminder
    if (reminders.appointment_24h && sends < MAX_SENDS) {
      const { data: appts } = await supabaseAdmin
        .from("appointments")
        .select("id, client_name, client_email, client_phone, barber_id, service_id, time_slot, total_amount, status")
        .eq("shop_id", shop.id).eq("date", tomorrow).in("status", ["pending", "confirmed"]);
      for (const a of appts ?? []) {
        if (sends >= MAX_SENDS) break;
        const when = a.time_slot ?? "";
        if (smsAllowed && a.client_phone) { await sendSmsBestEffort(a.client_phone, `Reminder: your appointment at ${shop.name} is tomorrow${when ? ` at ${when}` : ""}. See you then!`, shop.name); texts++; sends++; }
        if (a.client_email) {
          await sendEmail("appointment_reminder", {
            clientEmail: a.client_email, clientName: a.client_name ?? "there", shopId: shop.id, shopName: shop.name,
            shopEmail: shop.email, bookingId: a.id.slice(0, 8).toUpperCase(), barberName: "",
            serviceName: "", date: prettyDate(tomorrow), time: when, total: "",
          });
          emails++; sends++;
        }
      }
    }

    // ── 4-hour reminder (SMS + email, ~4h before the appointment) ────────────
    // On Vercel Hobby this cron only runs daily, so this block stays DORMANT (a
    // daily run's "gap since last run" is ~24h → the frequency gate below is
    // false). It AUTO-ACTIVATES the moment the cron starts running often — a
    // Vercel Pro "*/15" schedule, or any external scheduler hitting this
    // endpoint every 15–30 min with x-cron-secret. No code change, no toggle, no
    // redeploy needed: the owner just tightens the schedule and it turns on.
    //
    // Idempotent by a per-shop checkpoint (booking_settings.reminders._sameday_last_ms):
    // each appointment's "4h before" instant is crossed by exactly ONE run's
    // window (4 − gap < h ≤ 4), so the customer is messaged once even under a
    // 15-min cron. Defaults to follow the day-before toggle, so a shop that has
    // reminders on gets this for free once the schedule is frequent.
    const rm = reminders as Record<string, unknown>;
    const want4h = (rm.appointment_4h as boolean | undefined) ?? reminders.appointment_24h;
    if (want4h) {
      const nowMs = Date.now();
      const lastMs = Number(rm._sameday_last_ms ?? 0);
      const gapH = lastMs ? (nowMs - lastMs) / 3_600_000 : Infinity;
      // "Frequent enough" = the previous run was within ~100 min. A daily cron's
      // ~24h gap fails this, keeping the whole block dormant until upgrade.
      if (gapH <= 100 / 60 && sends < MAX_SENDS) {
        const { data: soon } = await supabaseAdmin
          .from("appointments")
          .select("id, client_name, client_email, client_phone, time_slot, date")
          .eq("shop_id", shop.id).in("date", [today, tomorrow]).in("status", ["pending", "confirmed"]);
        for (const a of soon ?? []) {
          if (sends >= MAX_SENDS) break;
          const h = hoursUntilBooking(a.date, a.time_slot, tz);
          // Fire once, when "4h before" fell between the last run and now:
          // 4 − gap < h ≤ 4, never for a past appointment. Window width = the
          // cron gap, so consecutive runs tile the timeline without overlap.
          if (h > 0 && h <= 4 && h > 4 - gapH) {
            const when = a.time_slot ?? "";
            // shop name is prepended by sendSmsBestEffort, so it's not repeated
            // in the body; one GSM-7 segment.
            if (smsAllowed && a.client_phone) { await sendSmsBestEffort(a.client_phone, `Reminder: your appointment is coming up at ${when}. See you soon!`, shop.name); texts++; sends++; }
            if (a.client_email) {
              await sendEmail("appointment_reminder", {
                clientEmail: a.client_email, clientName: a.client_name ?? "there", shopId: shop.id, shopName: shop.name,
                shopEmail: shop.email, bookingId: a.id.slice(0, 8).toUpperCase(), barberName: "",
                serviceName: "", date: prettyDate(a.date), time: when, total: "",
              });
              emails++; sends++;
            }
          }
        }
      }
      // Advance the checkpoint every run the feature is enabled (even when
      // dormant / nothing due) so "gap since last run" stays meaningful and the
      // first frequent run after an upgrade doesn't blast a backlog. Re-read the
      // row's settings right before writing so a concurrent settings save from
      // the owner isn't clobbered by the stale snapshot from the top of the run.
      const { data: fresh } = await supabaseAdmin.from("shops").select("booking_settings").eq("id", shop.id).maybeSingle();
      const bs = ((fresh?.booking_settings ?? shop.booking_settings) as Record<string, unknown> | null) ?? {};
      const freshRm = (bs.reminders as Record<string, unknown> | null) ?? {};
      await supabaseAdmin.from("shops").update({
        booking_settings: { ...bs, reminders: { ...freshRm, _sameday_last_ms: nowMs } },
      }).eq("id", shop.id).then(null, () => null);
    }

    // Rebooking (30d) + win-back (60d) — reuse existing templates
    const nudges: { when: string; type: string }[] = [];
    if (reminders.rebooking_30d) nudges.push({ when: d30, type: "rebooking_reminder" });
    if (reminders.winback_60d) nudges.push({ when: d60, type: "no_show_followup" });
    for (const n of nudges) {
      if (sends >= MAX_SENDS) break;
      const due = list.filter(c => c.last_visit === n.when && !!c.email);
      for (const c of due) {
        if (sends >= MAX_SENDS) break;
        await sendEmail(n.type, {
          clientEmail: c.email, clientName: c.name ?? "there", shopName: shop.name,
          shopEmail: shop.email, bookingUrl,
        });
        emails++; sends++;
      }
    }

    // Birthday (reads clients.birthday if the column exists)
    if (reminders.birthday && sends < MAX_SENDS) {
      const bdays = list.filter(c => !!c.email && typeof c.birthday === "string" && c.birthday.slice(5) === todayMMDD);
      for (const c of bdays) {
        if (sends >= MAX_SENDS) break;
        await sendEmail("birthday_wish", {
          clientEmail: c.email, clientName: c.name ?? "there", shopName: shop.name,
          shopEmail: shop.email, bookingUrl,
        });
        emails++; sends++;
      }
    }
  }

  return NextResponse.json({ ok: true, shops: shops.length, emails, texts, retagged });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await processTrials(Date.now()).catch(() => null);      // trial reminders + downgrades (same daily cron)
  await reconcileSubscriptions().catch(() => null);       // safety-net for a missed subscription webhook
  return run();
}
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await processTrials(Date.now()).catch(() => null);
  await reconcileSubscriptions().catch(() => null);
  return run();
}
