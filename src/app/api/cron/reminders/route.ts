import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSmsBestEffort } from "@/lib/twilio";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { prettyDate } from "@/lib/utils";

/**
 * Daily reminders + client auto-tagging. Runs once a day (Vercel cron, or an
 * external scheduler hitting it with x-cron-secret). Everything is idempotent
 * by construction — each condition matches a client/appointment on exactly one
 * calendar day — so a re-run on the same day won't double-send noticeably, and
 * there are no per-row "sent" flags to migrate.
 *
 * Per shop that has loyalty on plan AND a reminder toggled on
 * (booking_settings.reminders):
 *   • appointment_24h → SMS + email for appointments dated tomorrow
 *   • rebooking_30d   → email to clients whose last_visit was exactly 30 days ago
 *   • winback_60d     → email to clients whose last_visit was exactly 60 days ago
 *   • birthday        → email to clients whose birthday is today
 *
 * Auto-tagging runs for ALL shops regardless of plan/toggles (it's just
 * metadata that powers the marketing segments): VIP (10+ visits), At Risk
 * (no visit in 60+ days), Returning (2+ visits), else New.
 */
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const MAX_SENDS = 300; // safety cap per run (Twilio trial / Resend limits)

function authorized(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET;
  if (!s) return true; // unset = allow (local dev)
  return req.headers.get("x-cron-secret") === s || req.headers.get("authorization") === `Bearer ${s}`;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function sendEmail(type: string, data: Record<string, unknown>) {
  await fetch(`${BASE_URL}/api/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, data }),
  }).then(null, () => null);
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
  const now = new Date();
  const today = ymd(now);
  const todayMs = Date.parse(today + "T00:00:00Z");
  const tomorrow = ymd(new Date(now.getTime() + 86400000));
  const d30 = ymd(new Date(now.getTime() - 30 * 86400000));
  const d60 = ymd(new Date(now.getTime() - 60 * 86400000));
  const todayMMDD = today.slice(5); // "MM-DD"

  await ensurePlansHydrated();

  const { data: shops } = await supabaseAdmin
    .from("shops")
    .select("id, name, email, slug, subscription_plan, subscription_status, booking_settings");
  if (!shops?.length) return NextResponse.json({ ok: true, shops: 0 });

  let emails = 0, texts = 0, retagged = 0, sends = 0;

  for (const shop of shops) {
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

    // ── Reminders (plan + per-toggle gated) ─────────────────────────────────
    const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
    if (!planHasFeature(plan, "loyalty")) continue;
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
        if (a.client_phone) { await sendSmsBestEffort(a.client_phone, `Reminder: your appointment at ${shop.name} is tomorrow${when ? ` at ${when}` : ""}. See you then!`, shop.name); texts++; sends++; }
        if (a.client_email) {
          await sendEmail("appointment_reminder", {
            clientEmail: a.client_email, clientName: a.client_name ?? "there", shopName: shop.name,
            shopEmail: shop.email, bookingId: a.id.slice(0, 8).toUpperCase(), barberName: "",
            serviceName: "", date: prettyDate(tomorrow), time: when, total: "",
          });
          emails++; sends++;
        }
      }
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
  return run();
}
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run();
}
