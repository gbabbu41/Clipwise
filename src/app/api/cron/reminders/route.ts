import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSmsBestEffort, toE164 } from "@/lib/twilio";
import { canReceivePromos } from "@/lib/consent";
import { effectivePlan, isPaidPlan } from "@/lib/validation";
import { canPromptPaymentSetup } from "@/lib/setup-prompts";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { prettyDate } from "@/lib/utils";
import { safeTz, todayInTz, shiftYmd, hoursUntilBooking } from "@/lib/timezone";
import { collectedTotals, type RevAppt, type RevTx } from "@/lib/revenue";
import { sendAppEmail } from "@/lib/emailer";
import { processTrials } from "@/lib/process-trials";
import { reconcileSubscriptions } from "@/lib/reconcile-subscriptions";
import { backfillMissingStripeFees } from "@/lib/backfill-fees";
import { backfillTerminalLocations } from "@/lib/terminal";

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
  return sendAppEmail(type, strData).then(null, () => null);
}

type ClientRow = {
  id: string; name: string; email: string | null; phone: string | null;
  total_visits: number | null; last_visit: string | null; tag: string | null;
  birthday?: string | null;
  // CASL consent (phase58/59) — read from select("*") below.
  promo_consent_status?: string | null;
  sms_reminder_opt_in?: boolean | null;
  sms_opted_out_at?: string | null;
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
    .select("id, name, email, slug, subscription_plan, subscription_status, trial_ends_at, stripe_subscription_id, booking_settings, timezone, google_place_id, owner_id, stripe_connected, created_at, connect_nudge_sent_at");
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

    // Customers who opted OUT of reminder texts (CASL — the booking-form checkbox).
    // Keyed by E164 so it matches the appointment's stored phone regardless of the
    // format it was typed in. Reminders are transactional, but we still honor a
    // customer who unticked "text me reminders".
    const reminderOptOut = new Set<string>();
    for (const c of list) {
      // Skip if they unticked reminders OR have a durable SMS opt-out (carrier STOP).
      if (c.sms_reminder_opt_in === false || c.sms_opted_out_at) {
        const e = toE164(c.phone);
        if (e) reminderOptOut.add(e);
      }
    }
    const remindersOk = (phone: string | null | undefined) => {
      const e = toE164(phone);
      return !(e && reminderOptOut.has(e));
    };
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
        if (smsAllowed && a.client_phone && remindersOk(a.client_phone)) { await sendSmsBestEffort(a.client_phone, `Reminder: your appointment at ${shop.name} is tomorrow${when ? ` at ${when}` : ""}. See you then!`, shop.name); texts++; sends++; }
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
            if (smsAllowed && a.client_phone && remindersOk(a.client_phone)) { await sendSmsBestEffort(a.client_phone, `Reminder: your appointment is coming up at ${when}. See you soon!`, shop.name); texts++; sends++; }
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
      // Rebooking / win-back are PROMOTIONAL — only to clients who can receive
      // promos (express consent or an implied-consent recent visit, never opted out).
      const due = list.filter(c => c.last_visit === n.when && !!c.email && canReceivePromos(c));
      for (const c of due) {
        if (sends >= MAX_SENDS) break;
        await sendEmail(n.type, {
          clientEmail: c.email, clientName: c.name ?? "there", shopName: shop.name,
          shopEmail: shop.email, bookingUrl,
          unsubscribeUrl: `${BASE_URL}/api/unsubscribe?c=${c.id}`, // marketing → must carry opt-out
        });
        emails++; sends++;
      }
    }

    // Birthday (reads clients.birthday if the column exists)
    if (reminders.birthday && sends < MAX_SENDS) {
      // Birthday offers are PROMOTIONAL — gate on consent like the other nudges.
      const bdays = list.filter(c => !!c.email && typeof c.birthday === "string" && c.birthday.slice(5) === todayMMDD && canReceivePromos(c));
      for (const c of bdays) {
        if (sends >= MAX_SENDS) break;
        await sendEmail("birthday_wish", {
          clientEmail: c.email, clientName: c.name ?? "there", shopName: shop.name,
          shopEmail: shop.email, bookingUrl, shopSlug: shop.slug ?? "", // template builds its own book link from the slug
          unsubscribeUrl: `${BASE_URL}/api/unsubscribe?c=${c.id}`, // marketing → must carry opt-out
        });
        emails++; sends++;
      }
    }

    // Barber + service lookups for this shop — used by the review safety-net and
    // the Monday weekly digest below. Small tables; one cheap read each.
    const barberNameById = new Map<string, string>();
    const activeBarbers: { id: string; name: string; email: string }[] = [];
    {
      const { data: barberRows } = await supabaseAdmin
        .from("barbers").select("id, name, email, is_active").eq("shop_id", shop.id);
      for (const b of barberRows ?? []) {
        barberNameById.set(b.id, b.name ?? "Your barber");
        if (b.is_active !== false && b.email) activeBarbers.push({ id: b.id, name: b.name ?? "there", email: b.email });
      }
    }
    const serviceNameById = new Map<string, string>();
    {
      const { data: svcRows } = await supabaseAdmin.from("services").select("id, name").eq("shop_id", shop.id);
      for (const s of svcRows ?? []) serviceNameById.set(s.id, s.name ?? "Your service");
    }

    // ── Review requests — morning-after safety-net ──────────────────────────
    // A "how was your visit?" the morning after an appointment that HAPPENED
    // (completed, or confirmed-and-past — never cancelled/no-show/pending). This
    // is what finally covers CASH / in-person visits the barber never taps
    // "Complete" on. review_request_sent_at (set here AND by the immediate
    // Complete-button / online-paid sends) avoids a repeat on a later run.
    // Concurrent sends still need a separate atomic claim/delivery design.
    if (sends < MAX_SENDS) {
      const yesterday = shiftYmd(today, -1);
      const { data: visited } = await supabaseAdmin
        .from("appointments")
        .select("id, client_name, client_email, barber_id, service_id")
        .eq("shop_id", shop.id).eq("date", yesterday)
        .in("status", ["completed", "confirmed"])
        .is("review_request_sent_at", null)
        .not("client_email", "is", null);
      for (const a of visited ?? []) {
        if (sends >= MAX_SENDS) break;
        if (!a.client_email) continue;
        const handled = await sendEmail("review_request", {
          clientName: a.client_name ?? "there", clientEmail: a.client_email,
          shopName: shop.name, shopEmail: shop.email,
          barberName: a.barber_id ? (barberNameById.get(a.barber_id) ?? "Your barber") : "Your barber",
          serviceName: a.service_id ? (serviceNameById.get(a.service_id) ?? "Your service") : "Your service",
          reviewUrl: `${BASE_URL}/book/${shop.slug ?? ""}/review?booking=${a.id}`,
          appointmentId: a.id,
          googlePlaceId: (shop as { google_place_id?: string }).google_place_id ?? "",
        });
        sends++; // Keep failed attempts inside the existing safety cap.
        // Sender success is provider acceptance OR existing already-reviewed
        // suppression, not confirmed inbox delivery. Do not stamp a rejection.
        if (handled && "success" in handled && handled.success) {
          const recorded = await supabaseAdmin.from("appointments")
            .update({ review_request_sent_at: new Date().toISOString() }).eq("id", a.id).then(null, () => null);
          if (!recorded || recorded.error) console.warn("[reminders-review] Could not record handled review request");
          emails++;
        }
      }
    }

    // ── Weekly schedule digest — Monday mornings, per active barber ──────────
    // Each barber with appointments in the coming 7 days gets a Monday digest of
    // their week. Barbers with an empty week are skipped so it's never spam.
    const isMonday = new Date(today + "T00:00:00Z").getUTCDay() === 1;
    if (isMonday && activeBarbers.length && sends < MAX_SENDS) {
      const weekEnd = shiftYmd(today, 6);
      const { data: weekAppts } = await supabaseAdmin
        .from("appointments")
        .select("id, date, time_slot, client_name, barber_id, service_id")
        .eq("shop_id", shop.id).gte("date", today).lte("date", weekEnd)
        .in("status", ["pending", "confirmed"])
        .order("date", { ascending: true });
      const byBarber = new Map<string, { date: string; time_slot: string | null; client_name: string | null; service_id: string | null }[]>();
      for (const a of weekAppts ?? []) {
        if (!a.barber_id) continue;
        if (!byBarber.has(a.barber_id)) byBarber.set(a.barber_id, []);
        byBarber.get(a.barber_id)!.push(a);
      }
      for (const b of activeBarbers) {
        if (sends >= MAX_SENDS) break;
        const appts = byBarber.get(b.id) ?? [];
        if (!appts.length) continue; // no empty-week spam
        let scheduleHtml = "";
        let lastDate = "";
        for (const a of appts) {
          if (a.date !== lastDate) {
            scheduleHtml += `<p style="font-weight:700;color:#111827;margin:14px 0 4px">${prettyDate(a.date)}</p>`;
            lastDate = a.date;
          }
          const svc = a.service_id ? (serviceNameById.get(a.service_id) ?? "") : "";
          scheduleHtml += `<div class="row"><span class="label">${a.time_slot ?? ""}</span><span class="val">${a.client_name ?? "—"}${svc ? " · " + svc : ""}</span></div>`;
        }
        scheduleHtml += `<p style="margin-top:14px;font-size:13px;color:#6B7280">${appts.length} appointment${appts.length === 1 ? "" : "s"} booked so far this week.</p>`;
        await sendEmail("weekly_schedule", {
          barberEmail: b.email, barberName: b.name, shopName: shop.name, shopEmail: shop.email ?? "",
          scheduleHtml,
        });
        emails++; sends++;
      }
    }

    // ── Owner weekly digest — Monday summary of the past 7 days (email only) ──
    // Owner-facing recap so they see the shop's week without opening the app. Only
    // sent when there was activity, so a dead week never triggers a "0s" email.
    if (isMonday && sends < MAX_SENDS) {
      const weekAgo = shiftYmd(today, -7);
      const yesterday = shiftYmd(today, -1);
      const [{ data: lwAppts }, { data: lwTxs }] = await Promise.all([
        supabaseAdmin.from("appointments")
          .select("client_name, total_amount, tax_amount, tip_amount, gift_applied, balance_due, payment_status, payment_method, payment_intent_id, status, barber_id")
          .eq("shop_id", shop.id).gte("date", weekAgo).lte("date", yesterday),
        supabaseAdmin.from("transactions")
          .select("client_name, amount, tip, tax, payment_method, created_at, payment_intent_id, source, refunded, barber_id")
          .eq("shop_id", shop.id).gte("created_at", `${weekAgo}T00:00:00`),
      ]);
      const lastWeekAppts = (lwAppts ?? []) as RevAppt[];
      const completed = lastWeekAppts.filter(a => a.status === "completed").length;
      const noShows = lastWeekAppts.filter(a => a.status === "no-show").length;
      const txCount = lwTxs?.length ?? 0;
      if (completed > 0 || noShows > 0 || txCount > 0) {
        const totals = collectedTotals(lastWeekAppts, (lwTxs ?? []) as RevTx[]);
        const { count: upcoming } = await supabaseAdmin.from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shop.id).gte("date", today).lte("date", shiftYmd(today, 6)).in("status", ["pending", "confirmed"]);
        const ownerId = (shop as { owner_id?: string | null }).owner_id;
        const { data: ownerRow } = ownerId
          ? await supabaseAdmin.from("users").select("email").eq("id", ownerId).maybeSingle()
          : { data: null as { email?: string | null } | null };
        const ownerEmail = ownerRow?.email || shop.email;
        if (ownerEmail) {
          await sendEmail("owner_weekly_digest", {
            ownerEmail, shopName: shop.name,
            completed: String(completed), noShows: String(noShows),
            collected: `$${totals.gross.toFixed(2)}`, upcoming: String(upcoming ?? 0),
          });
          emails++; sends++;
        }
      }
    }

    // ── Stripe Connect completion nudge (one-time, ~2 days after signup) ─────
    // A payments-capable shop (paid/trial plan — Starter is cash-only) that never
    // finished Connect silently can't take online payments / deposits / no-show
    // fees. Nudge the owner ONCE, a couple days in. connect_nudge_sent_at dedupes.
    if (canPromptPaymentSetup(shop) && (shop as { stripe_connected?: boolean }).stripe_connected !== true
        && !(shop as { connect_nudge_sent_at?: string | null }).connect_nudge_sent_at && sends < MAX_SENDS) {
      const createdAt = (shop as { created_at?: string | null }).created_at;
      const ageDays = createdAt ? (Date.now() - Date.parse(createdAt)) / 86_400_000 : 0;
      if (ageDays >= 2) {
        const ownerId = (shop as { owner_id?: string | null }).owner_id;
        const { data: ownerRow } = ownerId
          ? await supabaseAdmin.from("users").select("name, email").eq("id", ownerId).maybeSingle()
          : { data: null as { name?: string | null; email?: string | null } | null };
        const ownerEmail = ownerRow?.email || shop.email;
        if (ownerEmail) {
          await sendEmail("connect_reminder", { ownerEmail, ownerName: ownerRow?.name ?? "", shopName: shop.name });
          await supabaseAdmin.from("shops").update({ connect_nudge_sent_at: new Date().toISOString() }).eq("id", shop.id).then(null, () => null);
          emails++; sends++;
        }
      }
    }
  }

  return NextResponse.json({ ok: true, shops: shops.length, emails, texts, retagged });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const lifecycleOk = await runSubscriptionMaintenance();
  await backfillMissingStripeFees().catch(() => null);    // fill stripe_fee that wasn't ready at charge time
  await backfillTerminalLocations().catch(() => null);    // ensure a Terminal Location for already-onboarded shops
  const result = await run();
  return lifecycleOk ? result : NextResponse.json({ error: "Reminders processed, but subscription maintenance needs retry." }, { status: 503 });
}
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const lifecycleOk = await runSubscriptionMaintenance();
  await backfillMissingStripeFees().catch(() => null);    // Vercel's scheduled GET needs the same fee repair as manual POST
  const result = await run();
  return lifecycleOk ? result : NextResponse.json({ error: "Reminders processed, but subscription maintenance needs retry." }, { status: 503 });
}

async function runSubscriptionMaintenance(): Promise<boolean> {
  // Keep independent jobs running, but expose failures to the scheduler instead
  // of returning a misleading successful run after silently swallowing them.
  const results = await Promise.allSettled([processTrials(Date.now()), reconcileSubscriptions()]);
  const ok = results.every(result => result.status === "fulfilled");
  if (!ok) console.error("[reminders] subscription maintenance incomplete");
  return ok;
}
