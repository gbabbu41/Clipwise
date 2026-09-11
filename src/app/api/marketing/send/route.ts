import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAppEmail } from "@/lib/emailer";
import { effectivePlan, isPaidPlan } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { canReceivePromos } from "@/lib/consent";
import { normPhone } from "@/lib/client-identity";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://clipwise.ca";
// One campaign can reach at most this many recipients — protects the email
// provider's rate/volume limits and is a sane abuse ceiling. Anything beyond is
// reported back as skipped so the owner is never misled about how many were sent.
const MAX_RECIPIENTS = 500;

type InRecipient = { name?: string | null; email?: string | null; phone?: string | null; clientId?: string | null };

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

/**
 * Send an email marketing campaign to a shop's clients — server-side, in one
 * call. Replaces the old per-recipient fetch loop in the Marketing page, which:
 *   • silently capped at 50 (the "Send to N" button then lied for bigger lists),
 *   • counted a send even when the request failed (fetch().catch → sent++), and
 *   • stopped dead if the owner closed the tab mid-send.
 * Here the whole batch runs on the server: ownership + paid-plan checked once,
 * each recipient is resolved to a real client row (so unsubscribe works),
 * marketing opt-out is re-enforced server-side (CASL), only genuine successes
 * are counted, and the campaign is recorded once with the true number sent.
 *
 * Auth: the shop's owner on a paid plan. Body: { shop_id, campaignName,
 * segmentLabel, subject, body, recipients:[{name,email,phone,clientId?}] }.
 */
export async function POST(req: NextRequest) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email isn't configured." }, { status: 500 });
  }
  // Abuse guard: a handful of campaigns per window per shop/IP.
  const limited = enforceRateLimit(req, "marketing-send", 6, 10 * 60_000);
  if (limited) return limited;

  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user } } = await supabaseAdmin.auth.getUser(bearer);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    shop_id?: string; campaignName?: string; segmentLabel?: string;
    subject?: string; body?: string; recipients?: InRecipient[];
    coupon?: { code?: string; percent?: number; expiryDays?: number };
  };
  const { shop_id } = body;
  const subject = (body.subject ?? "").trim();
  const message = (body.body ?? "").trim();
  const recipients = Array.isArray(body.recipients) ? body.recipients : [];
  if (!shop_id) return NextResponse.json({ error: "Missing shop" }, { status: 400 });
  if (!subject || !message) return NextResponse.json({ error: "Subject and message are required." }, { status: 400 });
  if (recipients.length === 0) return NextResponse.json({ error: "No recipients." }, { status: 400 });

  // Ownership + paid plan (IDOR guard: only the owner of THIS shop can blast it).
  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, name, email, slug, owner_id, subscription_plan, subscription_status")
    .eq("id", shop_id).maybeSingle();
  if (!shop || shop.owner_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await ensurePlansHydrated();
  if (!isPaidPlan(effectivePlan(shop.subscription_plan ?? undefined, shop.subscription_status ?? undefined))) {
    return NextResponse.json({ error: "Marketing campaigns are available on the Pro and Premium plans." }, { status: 403 });
  }

  const shopName = shop.name || "our shop";
  const bookingUrl = `${BASE_URL}/book/${shop.slug ?? ""}`;
  const capped = recipients.slice(0, MAX_RECIPIENTS);
  const overflow = recipients.length - capped.length;

  // Optional coupon: auto-create (or refresh) a REAL promo_codes row so the code
  // the email advertises actually works at checkout — the original bug was a
  // template writing "COMEBACK10" that nothing ever created. The owner controls
  // the code + %. If creation fails we DROP the banner rather than promise a
  // code the booking flow will reject.
  let couponHtml = "";
  let couponCode: string | null = null;
  const rawCode = (body.coupon?.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
  const pct = Math.round(Number(body.coupon?.percent ?? 0));
  if (rawCode && pct >= 1 && pct <= 100) {
    const days = Math.round(Number(body.coupon?.expiryDays ?? 0));
    const expires_at = days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10) : null;
    try {
      const { data: existing } = await supabaseAdmin
        .from("promo_codes").select("id").eq("shop_id", shop_id).eq("code", rawCode).maybeSingle();
      if (existing) {
        await supabaseAdmin.from("promo_codes")
          .update({ discount_type: "percent", discount_value: pct, is_active: true, expires_at })
          .eq("id", existing.id);
      } else {
        await supabaseAdmin.from("promo_codes").insert({
          shop_id, code: rawCode, discount_type: "percent", discount_value: pct,
          uses_left: null, total_uses: 0, expires_at, is_active: true,
        });
      }
      couponCode = rawCode;
      const expLine = expires_at
        ? `<div style="font-size:12px;color:#047857;margin-top:6px;">Valid until ${expires_at}</div>` : "";
      couponHtml = `<div style="margin:22px 0;padding:18px;border:2px dashed #10b981;border-radius:14px;text-align:center;background:#ecfdf5;">
        <div style="font-size:13px;color:#065f46;font-weight:600;letter-spacing:.04em;text-transform:uppercase;">${pct}% off your next visit</div>
        <div style="font-size:26px;font-weight:800;color:#065f46;letter-spacing:.06em;margin-top:4px;">${esc(rawCode)}</div>
        <div style="font-size:12px;color:#047857;margin-top:6px;">Enter this code at checkout</div>
        ${expLine}
      </div>`;
    } catch { couponHtml = ""; couponCode = null; }
  }

  let sent = 0;
  let skipped = 0;
  for (const r of capped) {
    const email = (r.email ?? "").trim();
    if (!email) { skipped++; continue; }
    const name = (r.name ?? "").trim();
    const phone = (r.phone ?? "").trim();

    // Resolve the recipient to a real client row (dedupe id → email → phone) so
    // the unsubscribe link works and past/walk-in recipients join the client book.
    // `select("*")` (not the new columns by name) so this keeps working even if the
    // phase58 consent columns haven't been migrated on prod yet.
    type PromoClient = { id: string; promo_consent_status?: string | null; last_visit?: string | null };
    let client: PromoClient | null = null;
    let clientId = (r.clientId ?? "").trim();
    if (clientId.startsWith("synthetic:")) clientId = "";
    if (clientId) {
      // Client id supplied — must belong to THIS shop (never email a client the caller doesn't own).
      const { data } = await supabaseAdmin.from("clients").select("*").eq("shop_id", shop_id).eq("id", clientId).maybeSingle();
      client = (data as PromoClient | null) ?? null;
    }
    if (!client && email) {
      const { data } = await supabaseAdmin.from("clients").select("*").eq("shop_id", shop_id).ilike("email", email).maybeSingle();
      client = (data as PromoClient | null) ?? null;
    }
    const np = normPhone(phone);
    if (!client && np) {
      const { data } = await supabaseAdmin.from("clients").select("*").eq("shop_id", shop_id).eq("phone_normalized", np).limit(1);
      client = (data?.[0] as PromoClient | null) ?? null;
    }
    if (!client) {
      // Unknown contact — add them to the book, but never email without consent.
      const { data: created } = await supabaseAdmin.from("clients").insert({
        shop_id, name: name || "Client", email: email.slice(0, 120), phone: phone.slice(0, 30),
        total_visits: 0, total_spent: 0, loyalty_points: 0, tag: "New",
      }).select("*").single().then((res) => res, () => ({ data: null }));
      client = (created as PromoClient | null) ?? null;
    }
    if (!client) { skipped++; continue; }
    // CASL gate (the ONE rule): express consent OR a recent visit (implied),
    // never if they've opted out. Non-eligible recipients are skipped, not emailed.
    if (!canReceivePromos(client)) { skipped++; continue; }
    const clientId2 = client.id;

    const personalized = message
      .replace(/\{name\}/g, name || "there")
      .replace(/\{shop\}/g, shopName)
      .replace(/\{link\}/g, bookingUrl)
      .replace(/\{code\}/g, couponCode ?? "");
    const unsubscribeUrl = `${BASE_URL}/api/unsubscribe?c=${clientId2}`;
    const htmlBody = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;">
      <h2 style="color:#111827;margin:0 0 16px;font-size:20px;">${esc(shopName)}</h2>
      <div style="white-space:pre-line;color:#333333;line-height:1.6;font-size:15px;">${esc(personalized)}</div>
      ${couponHtml}
      <div style="margin-top:28px;text-align:center;">
        <a href="${esc(bookingUrl)}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 26px;border-radius:9999px;font-size:15px;">Book Now</a>
      </div>
      <div style="margin-top:28px;padding-top:16px;border-top:1px solid #eeeeee;font-size:12px;color:#999999;">
        You're receiving this because you're a client of ${esc(shopName)}.
        <br><a href="${esc(unsubscribeUrl)}" style="color:#999999;text-decoration:underline;">Unsubscribe</a> from marketing emails.
      </div>
    </div>`;

    const result = await sendAppEmail("marketing_campaign", {
      to: email, subject, shopEmail: shop.email ?? "", htmlBody,
    });
    if (result && "error" in result) { skipped++; continue; }
    sent++;
  }

  // Record the campaign once, with the TRUE number sent (best-effort).
  if (sent > 0) {
    await supabaseAdmin.from("campaigns").insert({
      shop_id,
      name: (body.campaignName ?? "").trim() || subject,
      segment: (body.segmentLabel ?? "").trim() || null,
      subject,
      recipients: sent,
      status: "sent",
    }).then(null, () => null);
  }

  return NextResponse.json({ ok: true, sent, skipped, overflow: Math.max(0, overflow) });
}
