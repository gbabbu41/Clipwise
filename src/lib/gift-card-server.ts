import { stripe } from "@/lib/stripe";
import { sendAppEmail } from "@/lib/emailer";

// Shared gift-card server helpers used by every sale path (customer online
// purchase, owner portal "charge card", owner "send link", owner "cash"), so
// codes, the Stripe checkout, and the delivery email are identical everywhere.

export function generateGiftCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
    if (i === 3 || i === 7) out += "-";
  }
  return out;
}

type GiftShop = { id: string; name: string; slug: string; stripe_account_id: string | null };

export type GiftMeta = {
  code: string; amount: number; note?: string | null;
  recipient_name?: string | null; recipient_email?: string | null;
  purchaser_name?: string | null; purchaser_email?: string | null;
};

/**
 * Create a Stripe Checkout for a gift-card purchase on the shop's connected
 * account (Connect required — money lands in the shop's own balance). The
 * gift_cards row is created on return via /gift-finalize, never here, so an
 * abandoned checkout can't mint a card. Returns the hosted payment URL.
 */
export async function createGiftCheckoutSession(opts: {
  shop: GiftShop; origin: string; meta: GiftMeta; returnPath?: string;
}): Promise<string | null> {
  const { shop, origin, meta } = opts;
  if (!shop.stripe_account_id) return null;
  // The page the buyer returns to after paying (portal vs public gift page). It
  // reads ?paid=1&session_id=… and calls /gift-finalize to mint + email the card.
  const ret = opts.returnPath || `/gift/${shop.slug}`;
  const sep = ret.includes("?") ? "&" : "?";
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "cad",
          product_data: { name: `${shop.name} — Gift Card` },
          unit_amount: Math.round(meta.amount * 100),
        },
        quantity: 1,
      }],
      customer_email: meta.purchaser_email || meta.recipient_email || undefined,
      payment_intent_data: meta.purchaser_email ? { receipt_email: meta.purchaser_email } : undefined,
      metadata: {
        flow: "gift_card_purchase",
        shop_id: shop.id,
        code: meta.code,
        amount: String(meta.amount),
        recipient_name: (meta.recipient_name ?? "").slice(0, 120),
        recipient_email: (meta.recipient_email ?? "").slice(0, 160),
        purchaser_name: (meta.purchaser_name ?? "").slice(0, 120),
        purchaser_email: (meta.purchaser_email ?? "").slice(0, 160),
        note: (meta.note ?? "").slice(0, 200),
      },
      success_url: `${origin}${ret}${sep}paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${ret}${sep}cancelled=1`,
    },
    { stripeAccount: shop.stripe_account_id },
  );
  return session.url;
}

/** The gift-card HTML (also reused to email a pay-by-link). */
export function giftCardEmailHtml(shopName: string, bookUrl: string, m: { code: string; amount: number; note?: string | null }, heading: string, intro: string): string {
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
    <h2 style="color:#111;margin:0 0 8px;">${heading}</h2>
    <p style="color:#444;line-height:1.6;">${intro}</p>
    <div style="margin:20px 0;padding:20px;border:2px dashed #bbb;border-radius:14px;text-align:center;">
      <div style="font-size:12px;color:#888;letter-spacing:1px;">GIFT CARD · ${shopName}</div>
      <div style="font-size:28px;font-weight:800;color:#111;margin:8px 0;">$${m.amount.toFixed(2)}</div>
      <div style="font-size:20px;font-weight:700;letter-spacing:2px;color:#111;font-family:monospace;">${m.code}</div>
    </div>
    ${m.note ? `<p style="color:#444;font-style:italic;">“${m.note}”</p>` : ""}
    <a href="${bookUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;">Book an appointment →</a>
    <p style="margin-top:20px;font-size:12px;color:#999;">Redeemable at ${shopName}. Present this code at checkout.</p>
  </div>`;
}

/** Deliver the code to the recipient + a receipt to the buyer (best-effort). */
export async function sendGiftCardEmails(opts: { shop: { name: string; slug: string; email: string | null }; baseUrl: string; meta: GiftMeta }): Promise<void> {
  const { shop, baseUrl, meta } = opts;
  const bookUrl = `${baseUrl}/book/${shop.slug}`;
  const send = async (to: string, subject: string, html: string) => {
    await sendAppEmail("marketing_campaign", { to, subject, htmlBody: html, shopEmail: shop.email ?? "" }).catch(() => null);
  };
  if (meta.recipient_email) {
    await send(meta.recipient_email, `You've got a gift card for ${shop.name}! 🎁`,
      giftCardEmailHtml(shop.name, bookUrl, meta, "A gift for you 🎁", `${meta.purchaser_name || "Someone"} sent you a $${meta.amount.toFixed(2)} gift card for ${shop.name}.`));
  }
  if (meta.purchaser_email && meta.purchaser_email !== meta.recipient_email) {
    await send(meta.purchaser_email, `Your gift card purchase — ${shop.name}`,
      giftCardEmailHtml(shop.name, bookUrl, meta, "Thanks for your purchase", `Your $${meta.amount.toFixed(2)} gift card for ${shop.name}${meta.recipient_name ? ` for ${meta.recipient_name}` : ""} is ready.`));
  }
}
