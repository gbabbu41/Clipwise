import { Resend } from "resend";
import { prettyDate } from "@/lib/utils";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Shared email engine. This holds the templates + the actual Resend send so it
// can be called TWO ways:
//   1. Over HTTP via /api/send-email (browser + cross-service callers). That
//      route adds the privileged-type auth gate before calling sendAppEmail.
//   2. In-process, directly, from trusted server code (cron, webhooks, waitlist
//      fan-out, Stripe finalize). These skip the HTTP hop entirely — no network
//      round-trip, no shared secret, nothing to configure in the environment.
//      That's the whole point: server-to-server emails must not silently fail
//      just because CRON_SECRET wasn't set.

// Types that carry attacker-controllable content or links (arbitrary HTML,
// recipient, or a login/invite URL). Only the HTTP route enforces this — a
// direct in-process caller is already trusted server code.
export const PRIVILEGED_EMAIL_TYPES = new Set([
  "marketing_campaign", "direct_message", "barber_invite", "barber_password_reset", "password_reset",
  // Link-bearing / customer-recipient types — gated so the HTTP endpoint can't
  // be an open phishing/spam relay (attacker sets the recipient + a payment/
  // booking URL). Legit HTTP callers pass a staff token or x-internal-secret.
  "payment_link", "waitlist_slot_open", "rebooking_reminder", "no_show_followup", "review_request",
  "trial_reminder", "trial_ended",
]);

// Escape HTML in the free-text fields that originate from untrusted sources
// (the public booking form: client name/email/phone/notes, shop/owner names).
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const HTML_FREETEXT_FIELDS = new Set([
  "clientName", "clientEmail", "clientPhone", "ownerName", "ownerEmail", "ownerPhone",
  "shopName", "senderName", "barberName", "serviceName", "note", "notes", "message",
  "reason", "city", "province", "address",
]);

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.FROM_EMAIL ?? "onboarding@resend.dev";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@clipwise.ca";
// Fall back to the real production domain (NOT localhost) — email links must
// work even if NEXT_PUBLIC_APP_URL isn't set in the environment. A localhost
// fallback silently produced dead links in every email.
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://clipwise.ca";

// ── Shared email wrapper ──────────────────────────────────────────────────────
function wrap(content: string) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#E5E7EB}
  .container{max-width:560px;margin:0 auto;padding:32px 16px}
  .card{background:#1C1C1E;border:1px solid #2D2D2D;border-radius:16px;padding:32px}
  .logo{font-size:22px;font-weight:800;color:#F5F0E6;letter-spacing:-0.5px;margin-bottom:28px}
  .logo span{color:#fff}
  h1{font-size:22px;font-weight:700;color:#fff;margin:0 0 8px}
  p{font-size:14px;line-height:1.6;color:#9CA3AF;margin:0 0 12px}
  .highlight{color:#fff}
  .badge{display:inline-block;background:#F5F0E620;border:1px solid #F5F0E640;color:#F5F0E6;font-size:12px;font-weight:600;padding:4px 12px;border-radius:999px;margin-bottom:20px}
  .btn{display:inline-block;background:#F5F0E6;color:#000;font-weight:700;font-size:14px;padding:12px 28px;border-radius:10px;text-decoration:none;margin:16px 0}
  .link-box{background:#111;border:1px solid #2D2D2D;border-radius:10px;padding:12px 16px;margin:16px 0}
  .link-box a{color:#F5F0E6;font-size:13px;text-decoration:none;word-break:break-all}
  .divider{border:0;border-top:1px solid #2D2D2D;margin:24px 0}
  .steps{list-style:none;padding:0;margin:16px 0}
  .steps li{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;font-size:14px;color:#9CA3AF}
  .step-num{background:#F5F0E620;border:1px solid #F5F0E640;color:#F5F0E6;width:24px;height:24px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;margin-top:1px}
  .footer{text-align:center;margin-top:24px;font-size:12px;color:#4B5563}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2D2D2D;font-size:13px}
  .row:last-child{border-bottom:0}
  .row .label{color:#6B7280}
  .row .val{color:#fff;font-weight:500}
  .green-badge{display:inline-block;background:#10B98120;border:1px solid #10B98140;color:#10B981;font-size:12px;font-weight:600;padding:4px 12px;border-radius:999px;margin-bottom:20px}
  .red-badge{display:inline-block;background:#EF444420;border:1px solid #EF444440;color:#EF4444;font-size:12px;font-weight:600;padding:4px 12px;border-radius:999px;margin-bottom:20px}
</style></head>
<body><div class="container"><div class="card">${content}</div>
<div class="footer">© ClipWise · <a href="${BASE_URL}" style="color:#F5F0E6;text-decoration:none">clipwise.ca</a></div>
</div></body></html>`;
}

// Customer-facing emails lead with the SHOP's name (it's the shop's email to
// their client), with a small "Powered by ClipWise" line so the platform stays
// present but the brand out front is the barbershop. Owner/barber/admin/platform
// emails keep the ClipWise logo instead (they're from the platform to its users).
function shopHeader(shopName?: string) {
  const name = shopName || "Your shop";
  return `<div style="font-size:22px;font-weight:800;color:#F5F0E6;letter-spacing:-0.3px;margin-bottom:2px">${name}</div>
    <div style="font-size:11px;color:#4B5563;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:26px">Powered by ClipWise</div>`;
}

// A "Location" row + a Google Maps "Get directions" link. Values are resolved
// centrally in sendAppEmail (from shopId) so callers only pass shopId, not the
// whole address. Returns "" when there's no address on file, so the email just
// omits the block cleanly.
function addressBlock(addressLine?: string, directionsUrl?: string) {
  const addr = (addressLine ?? "").trim();
  if (!addr) return "";
  const link = directionsUrl
    ? `\n    <p style="margin:8px 0 0;text-align:right"><a href="${directionsUrl}" style="color:#F5F0E6;font-size:13px;text-decoration:none">📍 Get directions →</a></p>`
    : "";
  return `<div class="row"><span class="label">Location</span><span class="val" style="text-align:right;max-width:62%">${addr}</span></div>${link}`;
}

// Resolve a shop's display address + a reliable Google Maps directions URL from
// its id. Mirrors the booking page's directionsUrl logic: prefer the exact
// place_id pin, strip a leading Canadian unit prefix so the geocoder doesn't
// misread "106-630" as a civic number, and include the postal code. Best-effort
// — any failure just yields no address block, never a broken email.
async function resolveShopLocation(shopId: string): Promise<{ line: string; url: string }> {
  try {
    const { data: shop } = await supabaseAdmin
      .from("shops")
      .select("name, address, city, province, postal_code, google_place_id")
      .eq("id", shopId).maybeSingle();
    if (!shop) return { line: "", url: "" };
    const line = [shop.address, shop.city, shop.province, shop.postal_code]
      .map(s => (s ?? "").toString().trim()).filter(Boolean).join(", ");
    const street = (shop.address ?? "")
      .replace(/^\s*(?:unit|apt|apartment|suite|ste|#)\.?\s*\d+\s*[-,]\s*/i, "")
      .replace(/^\s*\d+\s*-\s*(?=\d)/, "")
      .trim();
    const dest = [street, shop.city, shop.province, shop.postal_code]
      .map(s => (s ?? "").toString().trim()).filter(Boolean).join(", ");
    const q = encodeURIComponent(dest || shop.name || "");
    const url = q
      ? (shop.google_place_id
          ? `https://www.google.com/maps/dir/?api=1&destination=${q}&destination_place_id=${shop.google_place_id}`
          : `https://www.google.com/maps/dir/?api=1&destination=${q}`)
      : "";
    return { line: escapeHtml(line), url };
  } catch {
    return { line: "", url: "" };
  }
}

// ── Email templates ───────────────────────────────────────────────────────────

function adminNewApplication(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="badge">🔔 New Shop Application</div>
    <h1>New Shop Applied</h1>
    <p>A new barbershop has applied to join ClipWise and is waiting for your review.</p>
    <hr class="divider">
    <div class="row"><span class="label">Shop Name</span><span class="val">${data.shopName}</span></div>
    <div class="row"><span class="label">Owner</span><span class="val">${data.ownerName}</span></div>
    <div class="row"><span class="label">Email</span><span class="val">${data.ownerEmail}</span></div>
    <div class="row"><span class="label">Phone</span><span class="val">${data.ownerPhone || "—"}</span></div>
    <div class="row"><span class="label">Location</span><span class="val">${data.city}, ${data.province}</span></div>
    <div class="row"><span class="label">Services</span><span class="val">${data.services}</span></div>
    <div class="row"><span class="label">Submitted</span><span class="val">${new Date().toLocaleString("en-CA")}</span></div>
    <hr class="divider">
    <a href="${BASE_URL}/admin/shops" class="btn">Review in Admin Panel →</a>
  `);
}

function ownerSubmissionConfirmation(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="badge">✓ Application Received</div>
    <h1>Hi ${data.ownerName},</h1>
    <p>We've received your application for <span class="highlight">${data.shopName}</span> and will review it within <span class="highlight">24 hours</span>.</p>
    <hr class="divider">
    <p style="font-weight:600;color:#fff;margin-bottom:8px">What happens next:</p>
    <ul class="steps">
      <li><span class="step-num">1</span>Our team reviews your shop details</li>
      <li><span class="step-num">2</span>You receive an approval email</li>
      <li><span class="step-num">3</span>Your booking page goes live instantly</li>
      <li><span class="step-num">4</span>Start accepting bookings!</li>
    </ul>
    <hr class="divider">
    <p style="font-weight:600;color:#fff;margin-bottom:4px">Your future booking link:</p>
    <div class="link-box"><a href="${BASE_URL}/book/${data.slug}">${BASE_URL}/book/${data.slug}</a></div>
    <p style="font-size:12px;color:#4B5563">This link goes live once your shop is approved.</p>
    <hr class="divider">
    <p>Questions? Reply to this email and we'll get back to you.</p>
    <p style="color:#4B5563">— The ClipWise Team</p>
  `);
}

function ownerApproved(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="green-badge">🎉 You're Approved!</div>
    <h1>Congratulations, ${data.ownerName}!</h1>
    <p><span class="highlight">${data.shopName}</span> has been approved on ClipWise. Your booking page is now <span class="highlight">LIVE</span>!</p>
    <div class="link-box"><a href="${BASE_URL}/book/${data.slug}">${BASE_URL}/book/${data.slug}</a></div>
    <a href="${BASE_URL}/book/${data.slug}" class="btn">View Your Booking Page →</a>
    <hr class="divider">
    <p style="font-weight:600;color:#fff;margin-bottom:8px">Get your first booking:</p>
    <ul class="steps">
      <li><span class="step-num">1</span>Add this link to your Instagram bio</li>
      <li><span class="step-num">2</span>Share it on Facebook and WhatsApp</li>
      <li><span class="step-num">3</span>Text it to your existing clients</li>
      <li><span class="step-num">4</span>Watch the bookings come in!</li>
    </ul>
    <hr class="divider">
    <a href="${BASE_URL}/login" class="btn" style="background:#1C1C1E;color:#F5F0E6;border:1px solid #F5F0E640">Login to Dashboard →</a>
    <p style="font-size:12px;color:#4B5563;margin-top:8px">Email: ${data.ownerEmail}</p>
    <hr class="divider">
    <p style="color:#4B5563">Welcome to ClipWise! — The ClipWise Team</p>
  `);
}

function ownerRejected(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="red-badge">Application Update</div>
    <h1>Hi ${data.ownerName},</h1>
    <p>Thank you for applying to ClipWise.</p>
    <p>Unfortunately, we could not approve <span class="highlight">${data.shopName}</span> at this time.</p>
    <hr class="divider">
    <p style="font-weight:600;color:#fff;margin-bottom:4px">Reason:</p>
    <p style="background:#1a1a1a;border:1px solid #2D2D2D;border-radius:8px;padding:12px 16px;color:#E5E7EB">${data.reason || "No reason provided."}</p>
    <hr class="divider">
    <p>You are welcome to <a href="${BASE_URL}/onboarding" style="color:#F5F0E6">reapply</a> after addressing the above. If you have any questions, please reply to this email.</p>
    <p style="color:#4B5563">— The ClipWise Team</p>
  `);
}

function reviewRequest(data: Record<string, string>) {
  const googleUrl = data.googlePlaceId
    ? `https://search.google.com/local/writereview?placeid=${data.googlePlaceId}`
    : null;
  return wrap(`
    ${shopHeader(data.shopName)}
    <div class="green-badge">🌟 How was your visit?</div>
    <h1>Thanks for visiting, ${data.clientName}!</h1>
    <p>We hope you loved your experience at <span class="highlight">${data.shopName}</span>. Your feedback means everything to us and helps other clients find the best barbers.</p>
    <hr class="divider">
    <p style="font-weight:600;color:#fff;margin-bottom:4px">Your appointment:</p>
    <div class="row"><span class="label">Barber</span><span class="val">${data.barberName}</span></div>
    <div class="row"><span class="label">Service</span><span class="val">${data.serviceName}</span></div>
    <hr class="divider">
    ${googleUrl ? `<a href="${googleUrl}" class="btn">⭐ Leave a Google Review</a>
    <p style="font-size:12px;color:#4B5563;margin-top:8px">Takes 30 seconds and makes a huge difference!</p>` : `<a href="${data.reviewUrl}" class="btn">Leave a Review ★★★★★</a>
    <p style="font-size:12px;color:#4B5563;margin-top:8px">Only takes 30 seconds!</p>`}
    <hr class="divider">
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

function appointmentReminder(data: Record<string, string>) {
  return wrap(`
    ${shopHeader(data.shopName)}
    <div class="badge">⏰ Appointment Tomorrow</div>
    <h1>See you tomorrow, ${data.clientName}!</h1>
    <p>This is a reminder for your appointment at <span class="highlight">${data.shopName}</span> tomorrow.</p>
    <hr class="divider">
    <div class="row"><span class="label">Booking ID</span><span class="val">${data.bookingId}</span></div>
    ${data.barberName ? `<div class="row"><span class="label">Barber</span><span class="val">${data.barberName}</span></div>` : ""}
    ${data.serviceName ? `<div class="row"><span class="label">Service</span><span class="val">${data.serviceName}</span></div>` : ""}
    <div class="row"><span class="label">Date</span><span class="val">${data.date}</span></div>
    <div class="row"><span class="label">Time</span><span class="val">${data.time}</span></div>
    ${data.total ? `<div class="row"><span class="label">Total</span><span class="val">${data.total}</span></div>` : ""}
    ${addressBlock(data.shopAddressLine, data.shopDirectionsUrl)}
    <hr class="divider">
    <p style="font-size:12px;color:#6B7280">Need to cancel? Please contact the shop as soon as possible.</p>
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

function bookingConfirmation(data: Record<string, string>) {
  const manageUrl = data.appointmentId ? `${BASE_URL}/my-booking/${data.appointmentId}` : null;
  return wrap(`
    ${shopHeader(data.shopName)}
    <div class="green-badge">✓ Booking Confirmed</div>
    <h1>Hi ${data.clientName},</h1>
    <p>Your appointment at <span class="highlight">${data.shopName}</span> is confirmed!</p>
    <hr class="divider">
    <div class="row"><span class="label">Booking ID</span><span class="val">${data.bookingId}</span></div>
    <div class="row"><span class="label">Barber</span><span class="val">${data.barberName || "Any Available"}</span></div>
    <div class="row"><span class="label">Service</span><span class="val">${data.serviceName}</span></div>
    <div class="row"><span class="label">Date</span><span class="val">${data.date}</span></div>
    <div class="row"><span class="label">Time</span><span class="val">${data.time}</span></div>
    <div class="row"><span class="label">Total</span><span class="val">${data.total}</span></div>
    ${addressBlock(data.shopAddressLine, data.shopDirectionsUrl)}
    <hr class="divider">
    ${manageUrl ? `<a href="${manageUrl}" class="btn">View / Manage Booking →</a>
    <p style="font-size:12px;color:#4B5563;margin-top:8px">You can reschedule or cancel from the link above.</p>
    <hr class="divider">` : ""}
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

function rebookingReminder(data: Record<string, string>) {
  return wrap(`
    ${shopHeader(data.shopName)}
    <div class="badge">✂️ Time for a Fresh Cut?</div>
    <h1>Hey ${data.clientName}, it's been a while!</h1>
    <p>We haven't seen you at <span class="highlight">${data.shopName}</span> for a while. Your hair might be telling you something…</p>
    <p>Book your next appointment in seconds — no calls, no waiting.</p>
    <hr class="divider">
    <a href="${data.bookingUrl}" class="btn">Book Now →</a>
    ${data.promoNote ? `<p style="font-size:13px;color:#F5F0E6;margin-top:12px">${data.promoNote}</p>` : ""}
    <hr class="divider">
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

function noShowFollowUp(data: Record<string, string>) {
  return wrap(`
    ${shopHeader(data.shopName)}
    <div class="badge">👋 We Missed You!</div>
    <h1>Hey ${data.clientName}, we missed you!</h1>
    <p>It looks like you weren't able to make it to your appointment at <span class="highlight">${data.shopName}</span>. No worries — life happens!</p>
    <p>We'd love to see you. Book your next appointment at a time that works for you.</p>
    <hr class="divider">
    <a href="${data.bookingUrl}" class="btn">Book Again →</a>
    <hr class="divider">
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

function appointmentCancelled(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="red-badge">❌ Appointment Cancelled</div>
    <h1>Appointment Cancelled</h1>
    <p>A client has cancelled their appointment at <span class="highlight">${data.shopName}</span>.</p>
    <hr class="divider">
    <div class="row"><span class="label">Client</span><span class="val">${data.clientName}</span></div>
    <div class="row"><span class="label">Service</span><span class="val">${data.serviceName}</span></div>
    <div class="row"><span class="label">Barber</span><span class="val">${data.barberName}</span></div>
    <div class="row"><span class="label">Date</span><span class="val">${data.date}</span></div>
    <div class="row"><span class="label">Time</span><span class="val">${data.time}</span></div>
    <hr class="divider">
    <p style="font-size:13px;color:#6B7280">This time slot is now available for new bookings.</p>
    <a href="${BASE_URL}/dashboard/appointments" class="btn">View Appointments →</a>
    <p style="color:#4B5563">— The ClipWise Team</p>
  `);
}

function subscriptionCancelled(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="red-badge">Subscription Cancelled</div>
    <h1>Your subscription was cancelled</h1>
    <p>Your ClipWise subscription for <span class="highlight">${data.shopName}</span> has been cancelled. Your shop has been moved to the free <span class="highlight">Starter</span> plan.</p>
    <hr class="divider">
    <p>Premium features (customer payments, POS, extra barbers) are now locked. You can resubscribe anytime to restore them.</p>
    <a href="${BASE_URL}/dashboard/billing" class="btn">Reactivate Subscription →</a>
    <hr class="divider">
    <p style="color:#4B5563">— The ClipWise Team</p>
  `);
}

function birthdayWish(data: Record<string, string>) {
  return wrap(`
    ${shopHeader(data.shopName)}
    <div class="green-badge">🎂 Happy Birthday!</div>
    <h1>Happy Birthday, ${data.clientName}!</h1>
    <p>Everyone at <span class="highlight">${data.shopName}</span> is wishing you a fantastic birthday today.</p>
    <hr class="divider">
    <p>To celebrate, we'd love to treat you to a fresh cut. Book your birthday appointment and come in looking your best!</p>
    <a href="${BASE_URL}/book/${data.shopSlug}" class="btn">Book Your Birthday Cut →</a>
    <hr class="divider">
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

function newBookingOwner(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="badge">📅 New Booking</div>
    <h1>New appointment at ${data.shopName}</h1>
    <p>A client has just booked through your ClipWise page.</p>
    <hr class="divider">
    <div class="row"><span class="label">Client</span><span class="val">${data.clientName}</span></div>
    <div class="row"><span class="label">Email</span><span class="val">${data.clientEmail}</span></div>
    <div class="row"><span class="label">Phone</span><span class="val">${data.clientPhone}</span></div>
    <div class="row"><span class="label">Service</span><span class="val">${data.serviceName}</span></div>
    <div class="row"><span class="label">Barber</span><span class="val">${data.barberName}</span></div>
    <div class="row"><span class="label">Date</span><span class="val">${data.date}</span></div>
    <div class="row"><span class="label">Time</span><span class="val">${data.time}</span></div>
    <div class="row"><span class="label">Total</span><span class="val">${data.total}</span></div>
    <div class="row"><span class="label">Booking ID</span><span class="val">#${data.bookingId}</span></div>
    <hr class="divider">
    <a href="${BASE_URL}/dashboard/appointments" class="btn">View in Dashboard →</a>
    <p style="color:#4B5563">— The ClipWise Team</p>
  `);
}

function newBookingBarber(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="badge">✂️ New Appointment</div>
    <h1>Hi ${data.barberName}, you have a new booking!</h1>
    <p>A client has booked with you at <span class="highlight">${data.shopName}</span>.</p>
    <hr class="divider">
    <div class="row"><span class="label">Client</span><span class="val">${data.clientName}</span></div>
    <div class="row"><span class="label">Phone</span><span class="val">${data.clientPhone}</span></div>
    <div class="row"><span class="label">Service</span><span class="val">${data.serviceName}</span></div>
    <div class="row"><span class="label">Date</span><span class="val">${data.date}</span></div>
    <div class="row"><span class="label">Time</span><span class="val">${data.time}</span></div>
    <div class="row"><span class="label">Total</span><span class="val">${data.total}</span></div>
    <hr class="divider">
    <a href="${BASE_URL}/barber-dashboard/schedule" class="btn">View My Schedule →</a>
    <p style="color:#4B5563">— The ClipWise Team</p>
  `);
}

function appointmentRejected(data: Record<string, string>) {
  return wrap(`
    ${shopHeader(data.shopName)}
    <div class="red-badge">Appointment Cancelled</div>
    <h1>Hi ${data.clientName},</h1>
    <p>Unfortunately, your appointment at <span class="highlight">${data.shopName}</span> has been cancelled by the shop.</p>
    <hr class="divider">
    <div class="row"><span class="label">Service</span><span class="val">${data.serviceName}</span></div>
    <div class="row"><span class="label">Date</span><span class="val">${data.date}</span></div>
    <div class="row"><span class="label">Time</span><span class="val">${data.time}</span></div>
    ${data.reason ? `<hr class="divider">
    <p style="font-weight:600;color:#fff;margin-bottom:4px">Reason from the shop:</p>
    <p style="background:#1a1a1a;border:1px solid #2D2D2D;border-radius:8px;padding:12px 16px;color:#E5E7EB">${data.reason}</p>` : ""}
    <hr class="divider">
    <p>We're sorry for the inconvenience. You're welcome to book a new time that works for you.</p>
    <a href="${BASE_URL}/book/${data.shopSlug}" class="btn">Book Again →</a>
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

function paymentReceipt(data: Record<string, string>) {
  const isNoShow = data.noShow === "1";
  // No-show → warm "we missed you" opener + receipt + rebook, all in one email.
  // Otherwise → the standard payment receipt.
  const opener = isNoShow
    ? `${shopHeader(data.shopName)}
    <div class="badge">👋 We Missed You</div>
    <h1>Hey ${data.clientName}, we missed you!</h1>
    <p>You weren't able to make it to your appointment at <span class="highlight">${data.shopName}</span> — no worries, life happens. As noted when you booked, a no-show fee was applied; your receipt is below, and we'd love to see you next time.</p>`
    : `<div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.3px;margin-bottom:4px">${data.shopName}</div>
    <div style="font-size:12px;color:#6B7280;margin-bottom:22px">Receipt from ${data.shopName}</div>
    <div class="green-badge">💳 Payment Received</div>
    <h1>Hi ${data.clientName},</h1>
    <p>Thanks for your payment to <span class="highlight">${data.shopName}</span>${data.context ? ` for your ${data.context.toLowerCase()}` : ""}. ${data.shopName} is the seller for this purchase — your receipt is below.</p>`;
  const rebook = isNoShow && data.bookingUrl
    ? `<hr class="divider"><a href="${data.bookingUrl}" class="btn">Book Again →</a>`
    : "";
  return wrap(`
    ${opener}
    <hr class="divider">
    <div class="row"><span class="label">Sold by</span><span class="val">${data.shopName}</span></div>
    ${data.serviceName ? `<div class="row"><span class="label">Service</span><span class="val">${data.serviceName}</span></div>` : ""}
    ${data.date ? `<div class="row"><span class="label">Date</span><span class="val">${data.date}</span></div>` : ""}
    ${data.context ? `<div class="row"><span class="label">Charge</span><span class="val">${data.context}</span></div>` : ""}
    ${data.tax ? `
    <div class="row"><span class="label">Subtotal</span><span class="val">${data.subtotal}</span></div>
    <div class="row"><span class="label">${data.taxLabel || "Tax"}</span><span class="val">${data.tax}</span></div>
    ${data.tip ? `<div class="row"><span class="label">Tip</span><span class="val">${data.tip}</span></div>` : ""}
    <div class="row"><span class="label" style="color:#fff;font-weight:700">Amount Paid</span><span class="val" style="font-weight:700">${data.amount}</span></div>`
    : `<div class="row"><span class="label">Amount Paid</span><span class="val">${data.amount}</span></div>`}
    ${rebook}
    <hr class="divider">
    <p style="font-size:13px;color:#6B7280">This is your receipt — no action needed. Questions about this charge? Reply to this email to reach ${data.shopName} directly.</p>
    <p style="font-size:12px;color:#4B5563">Sent on behalf of ${data.shopName}. ClipWise provides the booking &amp; payment software; ${data.shopName} is the merchant of record for this purchase.</p>
  `);
}

function refundIssued(data: Record<string, string>) {
  return wrap(`
    ${shopHeader(data.shopName)}
    <div class="green-badge">💳 Refund Issued</div>
    <h1>Hi ${data.clientName},</h1>
    <p>A refund has been issued for your cancelled appointment at <span class="highlight">${data.shopName}</span>.</p>
    <hr class="divider">
    <div class="row"><span class="label">Service</span><span class="val">${data.serviceName}</span></div>
    <div class="row"><span class="label">Original Date</span><span class="val">${data.date}</span></div>
    <div class="row"><span class="label">Refund Amount</span><span class="val">${data.total}</span></div>
    <hr class="divider">
    <p style="font-size:13px;color:#6B7280">Refunds typically appear on your statement within 5–10 business days depending on your bank.</p>
    <p>We hope to see you again soon.</p>
    <a href="${BASE_URL}/book/${data.shopSlug}" class="btn">Book Again →</a>
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

// Schedule summary — pre-rendered rows (data.scheduleHtml) from the schedule
// route / weekly cron. `weekly` only changes the heading copy.
function scheduleEmail(data: Record<string, string>, weekly: boolean) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <h1>${weekly ? "Your schedule this week" : "Your schedule was updated"}</h1>
    <p>Hi <span class="highlight">${data.barberName ?? "there"}</span>, here's your weekly schedule at ${data.shopName ?? "your shop"}:</p>
    <div style="margin-top:16px">${data.scheduleHtml ?? ""}</div>
    <p style="margin-top:20px">Questions about your hours? Just reply to this email.</p>
  `);
}

function directMessageEmail(data: Record<string, string>) {
  const escaped = (data.content ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  const senderLine = data.senderName
    ? `<p style="color:#6B7280;font-size:13px;margin:0 0 4px">From ${data.senderName}</p>`
    : "";
  return wrap(`
    ${shopHeader(data.shopName)}
    ${senderLine}
    <h1 style="font-size:18px">Hi ${data.clientName},</h1>
    <div style="background:#111;border:1px solid #2D2D2D;border-radius:12px;padding:16px;margin:16px 0;font-size:15px;line-height:1.55;color:#E5E7EB">
      ${escaped}
    </div>
    <p style="font-size:13px;color:#6B7280">Reply to this email and your response will go straight to ${data.shopName}.</p>
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

function paymentLinkEmail(data: Record<string, string>) {
  // Money values arrive as numbers (JSON) or pre-formatted strings — normalise
  // both to "$X.XX" so the breakdown always reads like a proper receipt.
  const money = (v: unknown) => {
    if (typeof v === "number") return `$${v.toFixed(2)}`;
    const s = (v ?? "").toString().trim();
    if (!s) return "";
    return s.startsWith("$") ? s : `$${s}`;
  };
  const total = money(data.amount);
  const taxNum = typeof data.tax === "number"
    ? (data.tax as unknown as number)
    : parseFloat(String(data.tax ?? ""));
  const hasTax = Number.isFinite(taxNum) && taxNum > 0;
  // Itemise price + tax when the shop charges tax; otherwise a single Amount row
  // (so a no-tax booking never shows a confusing "$0.00 tax" line). The Total row
  // is emphasised so it's unmistakable what will be charged.
  const amountRows = hasTax
    ? `
    <div class="row"><span class="label">Subtotal</span><span class="val">${money(data.subtotal)}</span></div>
    <div class="row"><span class="label">${data.taxLabel || "Tax"}</span><span class="val">${money(data.tax)}</span></div>
    <div class="row"><span class="label" style="color:#fff;font-weight:700">Total</span><span class="val" style="font-weight:700">${total}</span></div>`
    : `
    <div class="row"><span class="label">Amount</span><span class="val">${total}</span></div>`;
  return wrap(`
    ${shopHeader(data.shopName)}
    <div class="badge">💳 Payment Requested</div>
    <h1>Hi ${data.clientName},</h1>
    <p><span class="highlight">${data.shopName}</span> has sent you a secure payment link for your appointment.</p>
    <hr class="divider">
    <div class="row"><span class="label">Service</span><span class="val">${data.serviceName}</span></div>
    <div class="row"><span class="label">Date</span><span class="val">${data.date}</span></div>
    <div class="row"><span class="label">Time</span><span class="val">${data.time}</span></div>
    ${amountRows}
    <hr class="divider">
    <a href="${data.paymentUrl}" class="btn">Pay Now →</a>
    <div class="link-box"><a href="${data.paymentUrl}">${data.paymentUrl}</a></div>
    <p style="font-size:13px;color:#6B7280">Payments are processed securely through Stripe. This link will stay valid for 24 hours.</p>
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

function timeOffRequest(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="badge">📅 Time-Off Request</div>
    <h1>${data.barberName} requested time off</h1>
    <p>One of your barbers has submitted a new time-off request for <span class="highlight">${data.shopName}</span>. Review and approve or deny it from your dashboard.</p>
    <hr class="divider">
    <div class="row"><span class="label">Barber</span><span class="val">${data.barberName}</span></div>
    <div class="row"><span class="label">Type</span><span class="val">${data.requestType}</span></div>
    <div class="row"><span class="label">Dates</span><span class="val">${data.dateRange}</span></div>
    ${data.timeRange ? `<div class="row"><span class="label">Hours</span><span class="val">${data.timeRange}</span></div>` : ""}
    ${data.reason ? `<hr class="divider"><p style="font-weight:600;color:#fff;margin-bottom:4px">Reason from ${data.barberName}:</p>
    <p style="background:#1a1a1a;border:1px solid #2D2D2D;border-radius:8px;padding:12px 16px;color:#E5E7EB">${data.reason}</p>` : ""}
    <hr class="divider">
    <a href="${BASE_URL}/dashboard/time-off" class="btn">Review in Dashboard →</a>
    <p style="color:#4B5563">— The ClipWise Team</p>
  `);
}

function timeOffDecision(data: Record<string, string>) {
  const approved = data.decision === "approved";
  const cancelled = data.decision === "cancelled";
  const modified = data.decision === "modified";
  const headline = approved
    ? "Your time off was approved"
    : cancelled
    ? "Your approved time off was cancelled"
    : modified
    ? "A day was removed from your approved time off"
    : "Your time off was denied";
  const badge = approved
    ? "✅ Time Off Approved"
    : cancelled
    ? "⚠️ Time Off Cancelled"
    : modified
    ? "✏️ Time Off Modified"
    : "❌ Time Off Denied";
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="badge">${badge}</div>
    <h1>${headline}</h1>
    <p>${data.shopName} reviewed your time-off request.</p>
    <hr class="divider">
    <div class="row"><span class="label">Type</span><span class="val">${data.requestType}</span></div>
    <div class="row"><span class="label">Dates</span><span class="val">${data.dateRange}</span></div>
    ${data.timeRange ? `<div class="row"><span class="label">Hours</span><span class="val">${data.timeRange}</span></div>` : ""}
    <div class="row"><span class="label">Decision</span><span class="val" style="color:${approved ? "#10B981" : cancelled || modified ? "#F59E0B" : "#EF4444"};text-transform:uppercase;font-weight:600">${data.decision}</span></div>
    ${approved
      ? `<p style="color:#9CA3AF">Your schedule has been updated — these slots will no longer be offered to customers during this window.</p>`
      : cancelled
      ? `<p style="color:#9CA3AF">Customers will once again be able to book during this window. If you still need the time off, please submit a new request.</p>`
      : modified
      ? `<p style="color:#9CA3AF">That single day was removed from your approved time off; the rest of your request still stands. You're expected to work that day — message your shop if you need to discuss.</p>`
      : `<p style="color:#9CA3AF">If you need to talk this through, message your shop directly.</p>`}
    <hr class="divider">
    <a href="${BASE_URL}/barber-dashboard/time-off" class="btn">View My Requests →</a>
    <p style="color:#4B5563">— The ClipWise Team</p>
  `);
}

function bookingRequestReceived(data: Record<string, string>) {
  return wrap(`
    ${shopHeader(data.shopName)}
    <div class="badge">⏳ Request received</div>
    <h1>Thanks, ${data.clientName}!</h1>
    <p>Your booking request at <span class="highlight">${data.shopName}</span> has been received and is <strong style="color:#fff">waiting for the shop to confirm</strong>. We'll email you as soon as it's approved.</p>
    <hr class="divider">
    <table style="width:100%;font-size:14px;color:#9CA3AF">
      <tr><td>Service</td><td style="text-align:right;color:#fff">${data.serviceName}</td></tr>
      <tr><td>Barber</td><td style="text-align:right;color:#fff">${data.barberName}</td></tr>
      <tr><td>Date</td><td style="text-align:right;color:#fff">${data.date}</td></tr>
      <tr><td>Time</td><td style="text-align:right;color:#fff">${data.time}</td></tr>
    </table>
    <hr class="divider">
    <p style="font-size:13px;color:#9CA3AF">Booking ref: <strong style="color:#fff">${data.bookingId}</strong> · You'll pay in person at the shop.</p>
    <a href="${BASE_URL}/my-booking/${data.appointmentId}" class="btn">View my booking →</a>
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

function barberInvite(data: Record<string, string>) {
  const existing = data.existingAccount === "true";
  const ctaText = existing ? "Open My Barber Dashboard →" : "Accept Invite & Set Up Account →";
  const leadParagraph = existing
    ? `<p>Good news — you already have a ClipWise account. Click the button below to sign in instantly and start managing your schedule at <span class="highlight">${data.shopName}</span>.</p>
       <p style="font-size:13px;color:#9CA3AF;background:#1a1a1a;border:1px solid #2D2D2D;border-radius:8px;padding:12px 16px">
         The link below logs you in automatically.
         You can keep using your <strong style="color:#fff">existing ClipWise password</strong> to sign in normally any time at <a href="${BASE_URL}/login" style="color:#F5F0E6">${BASE_URL}/login</a> — or
         <a href="${BASE_URL}/forgot-password" style="color:#F5F0E6">reset your password</a> if you've forgotten it.
       </p>`
    : `<p>Click the button below to set up your account and access your personal barber dashboard. You'll be asked to choose a password.</p>`;
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="badge">✂️ You're Invited!</div>
    <h1>Hi ${data.barberName},</h1>
    <p><span class="highlight">${data.shopName}</span> has invited you to join their team on ClipWise — the barbershop management platform.</p>
    ${leadParagraph}
    <hr class="divider">
    <p style="font-weight:600;color:#fff;margin-bottom:8px">With your barber portal you can:</p>
    <ul class="steps">
      <li><span class="step-num">1</span>View your daily schedule and upcoming appointments</li>
      <li><span class="step-num">2</span>Manage your availability hours</li>
      <li><span class="step-num">3</span>Track your earnings and commission</li>
      <li><span class="step-num">4</span>See your client history</li>
    </ul>
    <hr class="divider">
    <a href="${data.inviteLink}" class="btn">${ctaText}</a>
    <p style="font-size:12px;color:#4B5563;margin-top:8px">This link expires in 1 hour. If you didn't expect this, you can ignore it.</p>
    <hr class="divider">
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

function ownerPaymentReceived(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="badge">💰 Payment Received</div>
    <h1>You got paid</h1>
    <p><span class="highlight">${data.clientName}</span> paid <span class="highlight">${data.amount}</span> for ${data.serviceName}${data.date ? ` (${data.date}${data.time ? ` · ${data.time}` : ""})` : ""}.</p>
    <p style="font-size:13px;color:#9CA3AF">The appointment is now marked <strong style="color:#fff">Paid</strong> in your dashboard.</p>
    <a href="${BASE_URL}/dashboard/payments" class="btn">View payments →</a>
    <hr class="divider">
    <p style="color:#4B5563">— ClipWise</p>
  `);
}

function subscriptionStarted(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="badge">🎉 Subscription Active</div>
    <h1>You're all set!</h1>
    <p>Your <span class="highlight">${data.planName}</span> plan for <span class="highlight">${data.shopName}</span> is now active — every feature included in your plan is unlocked.</p>
    <a href="${BASE_URL}/dashboard" class="btn">Go to my dashboard →</a>
    <hr class="divider">
    <p style="font-size:13px;color:#9CA3AF">Billed monthly in CAD. You can change or cancel your plan anytime from
      <a href="${BASE_URL}/dashboard/billing" style="color:#F5F0E6">Billing</a> — cancelling stops future charges and
      keeps your plan active until the end of the billing period. No contracts, no hidden fees.</p>
    <p style="color:#4B5563">— ClipWise</p>
  `);
}

function barberPasswordReset(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="badge">🔑 Password Reset</div>
    <h1>Hi ${data.barberName},</h1>
    <p><span class="highlight">${data.shopName}</span> sent you a link to reset your ClipWise password.</p>
    <a href="${data.resetLink}" class="btn">Reset My Password →</a>
    <p style="font-size:12px;color:#4B5563;margin-top:8px">This link expires in 1 hour. If you didn't request this, you can safely ignore it — your password won't change.</p>
    <hr class="divider">
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

// Generic self-service password reset (owner / barber / customer). Sent through
// our own branded Resend email instead of Supabase's built-in mail, so it comes
// from clipwise.ca, isn't rate-limited by Supabase's shared SMTP, and doesn't
// land in spam. Platform-level account action → keeps the ClipWise brand.
function passwordReset(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="badge">🔑 Password Reset</div>
    <h1>Reset your password</h1>
    <p>We received a request to reset the password on your ClipWise account. Click below to choose a new one.</p>
    <a href="${data.resetLink}" class="btn">Reset My Password →</a>
    <p style="font-size:12px;color:#4B5563;margin-top:8px">This link expires in 1 hour. If you didn't request this, you can safely ignore it — your password won't change.</p>
    <hr class="divider">
    <p style="color:#4B5563">— The ClipWise Team</p>
  `);
}

function barberAppointmentChange(data: Record<string, string>) {
  const isNoShow = (data.statusLabel ?? "").toLowerCase().includes("no-show");
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="${isNoShow ? "badge" : "red-badge"}">${isNoShow ? "👀 No-Show" : "📅 Slot Freed Up"}</div>
    <h1>Hi ${data.barberName},</h1>
    <p>${isNoShow
      ? `Your appointment with <span class="highlight">${data.clientName}</span> was marked a no-show.`
      : `Your appointment with <span class="highlight">${data.clientName}</span> at ${data.shopName} was cancelled — this slot is now open again.`}</p>
    <hr class="divider">
    <div class="row"><span class="label">Status</span><span class="val">${data.statusLabel}</span></div>
    <div class="row"><span class="label">Client</span><span class="val">${data.clientName}</span></div>
    <div class="row"><span class="label">Service</span><span class="val">${data.serviceName}</span></div>
    <div class="row"><span class="label">Date</span><span class="val">${data.date}</span></div>
    <div class="row"><span class="label">Time</span><span class="val">${data.time}</span></div>
    <hr class="divider">
    <a href="${BASE_URL}/barber-dashboard/schedule" class="btn">View My Schedule →</a>
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

function shopOwnerNewBarberRequest(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="badge">👤 New Barber Request</div>
    <h1>New Barber Wants to Join</h1>
    <p><span class="highlight">${data.barberName}</span> has requested to join <span class="highlight">${data.shopName}</span> on ClipWise.</p>
    <hr class="divider">
    <div class="row"><span class="label">Name</span><span class="val">${data.barberName}</span></div>
    <div class="row"><span class="label">Email</span><span class="val">${data.barberEmail}</span></div>
    <div class="row"><span class="label">Phone</span><span class="val">${data.barberPhone || "—"}</span></div>
    ${data.bio ? `<div class="row"><span class="label">Bio</span><span class="val">${data.bio}</span></div>` : ""}
    <hr class="divider">
    <a href="${BASE_URL}/dashboard/staff" class="btn">Approve or Reject in Dashboard →</a>
    <p style="color:#4B5563">— The ClipWise Team</p>
  `);
}

function waitlistSlotOpen(data: Record<string, string>) {
  return wrap(`
    ${shopHeader(data.shopName)}
    <div class="badge">🎉 A Spot Opened Up</div>
    <h1>Hi ${data.clientName},</h1>
    <p>Good news — a spot just opened at <span class="highlight">${data.shopName}</span> on the day you were waiting for. Spots go fast, so book now to grab it.</p>
    <hr class="divider">
    <div class="row"><span class="label">Date</span><span class="val">${data.date}</span></div>
    ${data.barberName ? `<div class="row"><span class="label">Barber</span><span class="val">${data.barberName}</span></div>` : ""}
    <hr class="divider">
    <a href="${data.bookingUrl}" class="btn">Book Now →</a>
    <div class="link-box"><a href="${data.bookingUrl}">${data.bookingUrl}</a></div>
    <p style="font-size:13px;color:#6B7280">You're receiving this because you asked to be notified when a spot opened. No further action is needed if you've already booked elsewhere.</p>
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

// ── Core dispatch ─────────────────────────────────────────────────────────────
export type SendResult = { success: true } | { error: unknown };

/**
 * Build + send one transactional email. Does NOT enforce the privileged-type
 * auth gate — that lives on the /api/send-email HTTP boundary. Direct callers
 * are trusted server code.
 */
function trialReminder(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="green-badge">⏳ ${data.daysLeft} left on your trial</div>
    <h1>Your ${data.planName} trial ends ${data.daysLeft === "1 day" ? "tomorrow" : `in ${data.daysLeft}`}</h1>
    <p>Hi ${data.ownerName || "there"} — <span class="highlight">${data.shopName}</span> is on the ${data.planName} free trial. Add a card to keep your paid features (online payments, POS, loyalty, extra barbers) once it ends.</p>
    <a href="${BASE_URL}/dashboard/billing" class="btn">Add your card →</a>
    <hr class="divider">
    <p style="color:#4B5563">No charge until you subscribe. If you do nothing, your shop simply drops to the free Starter plan — your account and bookings stay safe. — The ClipWise Team</p>
  `);
}

function trialEnded(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <h1>Your ${data.planName} trial has ended</h1>
    <p>Hi ${data.ownerName || "there"} — the free trial for <span class="highlight">${data.shopName}</span> is over, so your shop is now on the free <span class="highlight">Starter</span> plan. Your account, booking page and bookings are all safe — you've just lost the paid features (online payments, POS, loyalty, extra barbers).</p>
    <a href="${BASE_URL}/dashboard/billing" class="btn">Subscribe to turn them back on →</a>
    <hr class="divider">
    <p style="color:#4B5563">Add a card anytime and your paid features switch back on instantly. — The ClipWise Team</p>
  `);
}

export async function sendAppEmail(type: string, data: Record<string, string>): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY) {
    return { error: "RESEND_API_KEY not configured" };
  }

  // Normalize raw "YYYY-MM-DD" dates to a human-readable label once, here —
  // every template + subject reads `data.date`. Idempotent.
  if (data?.date) data.date = prettyDate(data.date);

  // Neutralize HTML in untrusted free-text before it hits any template.
  // marketing_campaign carries an intentional htmlBody, so it's exempt.
  if (data && type !== "marketing_campaign") {
    for (const k of Object.keys(data)) {
      if (HTML_FREETEXT_FIELDS.has(k) && typeof data[k] === "string") data[k] = escapeHtml(data[k]);
    }
  }

  // Booking confirmations + reminders show the shop's address and a Google Maps
  // "Get directions" link so customers can actually find the shop. Resolve it
  // once, centrally, from shopId — callers only need to pass shopId. Best-effort:
  // no address on file (or any error) simply omits the location block.
  if ((type === "booking_confirmation" || type === "appointment_reminder") && data?.shopId && !data.shopAddressLine) {
    const loc = await resolveShopLocation(data.shopId);
    data.shopAddressLine = loc.line;
    data.shopDirectionsUrl = loc.url;
  }

  // Owner-customized templates (Settings → Notifications, stored in
  // shops.notification_templates). If the shop saved a custom subject/body for
  // this email type, use it — with {placeholder} substitution — instead of the
  // built-in copy. Falls back to the built-in when absent/empty or the shop
  // can't be resolved. Only these three types are editable in Settings.
  let customTpl: { subject?: string; body?: string } | null = null;
  const TEMPLATED = new Set(["booking_confirmation", "appointment_reminder", "appointment_rejected"]);
  if (TEMPLATED.has(type) && data?.shopId) {
    try {
      const { data: shopRow } = await supabaseAdmin
        .from("shops").select("notification_templates").eq("id", data.shopId).maybeSingle();
      const tpls = (shopRow?.notification_templates ?? null) as Record<string, { subject?: string; body?: string }> | null;
      const t = tpls?.[type];
      if (t && (t.subject?.trim() || t.body?.trim())) customTpl = t;
    } catch { /* fall back to the built-in template */ }
  }
  // Substitute the editor's placeholders with the (already HTML-escaped) values.
  const fillTpl = (s: string) => (s || "")
    .replace(/\{shopName\}/g, String(data.shopName ?? ""))
    .replace(/\{clientName\}/g, String(data.clientName ?? ""))
    .replace(/\{serviceName\}/g, String(data.serviceName ?? ""))
    .replace(/\{barberName\}/g, String(data.barberName ?? ""))
    .replace(/\{date\}/g, String(data.date ?? ""))
    .replace(/\{time\}/g, String(data.time ?? ""));
  // Use the custom template when present, else the built-in subject + html.
  const applyCustom = (fallbackSubject: string, fallbackHtml: () => string): { subject: string; html: string } => {
    if (!customTpl) return { subject: fallbackSubject, html: fallbackHtml() };
    const subj = customTpl.subject?.trim() ? fillTpl(customTpl.subject) : fallbackSubject;
    const bodyHtml = customTpl.body?.trim() ? fillTpl(customTpl.body).replace(/\n/g, "<br>") : "";
    return { subject: subj, html: bodyHtml ? wrap(`<div style="font-size:15px;line-height:1.65;color:#333;">${bodyHtml}</div>`) : fallbackHtml() };
  };

  let to = "";
  let subject = "";
  let html = "";

  switch (type) {
    case "new_shop_application":
      to = ADMIN_EMAIL;
      subject = `New Shop Application — ${data.shopName}`;
      html = adminNewApplication(data);
      break;
    case "shop_submitted_confirmation":
      to = data.ownerEmail;
      subject = "Application Received — ClipWise";
      html = ownerSubmissionConfirmation(data);
      break;
    case "shop_approved":
      to = data.ownerEmail;
      subject = "You're Approved! Welcome to ClipWise 🎉";
      html = ownerApproved(data);
      break;
    case "shop_rejected":
      to = data.ownerEmail;
      subject = "Application Update — ClipWise";
      html = ownerRejected(data);
      break;
    case "booking_confirmation": {
      to = data.clientEmail;
      const r = applyCustom(`Booking Confirmed — ${data.shopName}`, () => bookingConfirmation(data));
      subject = r.subject; html = r.html;
      break;
    }
    case "appointment_reminder": {
      to = data.clientEmail;
      const r = applyCustom(`Reminder: Your appointment tomorrow at ${data.shopName}`, () => appointmentReminder(data));
      subject = r.subject; html = r.html;
      break;
    }
    case "review_request":
      to = data.clientEmail;
      subject = `How was your visit to ${data.shopName}? ⭐`;
      html = reviewRequest(data);
      break;
    case "appointment_cancelled":
      to = data.ownerEmail;
      subject = `Appointment Cancelled — ${data.clientName}`;
      html = appointmentCancelled(data);
      break;
    case "rebooking_reminder":
      to = data.clientEmail;
      subject = `Time for a fresh cut at ${data.shopName}?`;
      html = rebookingReminder(data);
      break;
    case "no_show_followup":
      to = data.clientEmail;
      subject = `We missed you — Book again at ${data.shopName}`;
      html = noShowFollowUp(data);
      break;
    case "new_barber_request":
      to = data.ownerEmail;
      subject = `New Barber Request — ${data.barberName}`;
      html = shopOwnerNewBarberRequest(data);
      break;
    case "birthday_wish":
      to = data.clientEmail;
      subject = `Happy Birthday from ${data.shopName}! 🎂`;
      html = birthdayWish(data);
      break;
    case "subscription_cancelled":
      to = data.ownerEmail;
      subject = "Your ClipWise subscription was cancelled";
      html = subscriptionCancelled(data);
      break;
    case "time_off_request":
      to = data.ownerEmail;
      subject = `Time-off request — ${data.barberName} (${data.requestType})`;
      html = timeOffRequest(data);
      break;
    case "time_off_decision":
      to = data.barberEmail;
      subject = `Your time-off request was ${data.decision} — ${data.shopName}`;
      html = timeOffDecision(data);
      break;
    case "new_booking_owner":
      to = data.ownerEmail;
      subject = `New booking — ${data.clientName} · ${data.shopName}`;
      html = newBookingOwner(data);
      break;
    case "new_booking_barber":
      to = data.barberEmail;
      subject = `New appointment — ${data.clientName} on ${data.date}`;
      html = newBookingBarber(data);
      break;
    case "appointment_rejected": {
      to = data.clientEmail;
      const r = applyCustom(`Your appointment at ${data.shopName} has been cancelled`, () => appointmentRejected(data));
      subject = r.subject; html = r.html;
      break;
    }
    case "refund_issued":
      to = data.clientEmail;
      subject = `Refund issued — ${data.shopName}`;
      html = refundIssued(data);
      break;
    case "payment_receipt":
      to = data.clientEmail;
      subject = data.noShow === "1" ? `We missed you — receipt from ${data.shopName}` : `Payment received — ${data.shopName}`;
      html = paymentReceipt(data);
      break;
    case "barber_appointment_change":
      to = data.barberEmail;
      subject = `${data.statusLabel}: ${data.clientName} on ${data.date} — ${data.shopName}`;
      html = barberAppointmentChange(data);
      break;
    case "payment_link":
      to = data.clientEmail;
      subject = `Complete your payment for ${data.shopName}`;
      html = paymentLinkEmail(data);
      break;
    case "direct_message":
      to = data.clientEmail;
      subject = `Message from ${data.shopName}`;
      html = directMessageEmail(data);
      break;
    case "schedule_updated":
      to = data.barberEmail;
      subject = `Your schedule at ${data.shopName} was updated`;
      html = scheduleEmail(data, false);
      break;
    case "weekly_schedule":
      to = data.barberEmail;
      subject = `Your schedule this week — ${data.shopName}`;
      html = scheduleEmail(data, true);
      break;
    case "booking_request_received":
      to = data.clientEmail;
      subject = `We got your request — ${data.shopName}`;
      html = bookingRequestReceived(data);
      break;
    case "barber_invite":
      to = data.barberEmail;
      subject = `You're invited to join ${data.shopName} on ClipWise`;
      html = barberInvite(data);
      break;
    case "barber_password_reset":
      to = data.barberEmail;
      subject = `Reset your password — ${data.shopName}`;
      html = barberPasswordReset(data);
      break;
    case "password_reset":
      to = data.email;
      subject = "Reset your ClipWise password";
      html = passwordReset(data);
      break;
    case "subscription_started":
      to = data.ownerEmail;
      subject = `Your ${data.planName} plan is active — ClipWise`;
      html = subscriptionStarted(data);
      break;
    case "owner_payment_received":
      to = data.ownerEmail;
      subject = `Payment received — ${data.amount} from ${data.clientName}`;
      html = ownerPaymentReceived(data);
      break;
    case "waitlist_slot_open":
      to = data.clientEmail;
      subject = `A spot opened up at ${data.shopName} 🎉`;
      html = waitlistSlotOpen(data);
      break;
    case "marketing_campaign":
      to = data.to;
      subject = data.subject;
      html = data.htmlBody;
      break;
    case "trial_reminder":
      to = data.ownerEmail;
      subject = `${data.daysLeft} left on your ClipWise ${data.planName} trial`;
      html = trialReminder(data);
      break;
    case "trial_ended":
      to = data.ownerEmail;
      subject = `Your ClipWise ${data.planName} trial has ended`;
      html = trialEnded(data);
      break;
    default:
      return { error: "Unknown email type" };
  }

  // ── Reply-To routing ────────────────────────────────────────────────────
  // Customer/barber-facing → shop owner ONLY (never leak ADMIN_EMAIL to the
  // public). Owner-facing + admin emails → platform admin is appropriate.
  const customerOrBarberFacing = [
    "booking_confirmation", "appointment_reminder", "review_request",
    "appointment_rejected", "refund_issued", "rebooking_reminder",
    "no_show_followup", "birthday_wish", "payment_link", "direct_message",
    "barber_invite", "barber_password_reset", "new_booking_barber", "payment_receipt",
    "barber_appointment_change", "waitlist_slot_open", "booking_request_received",
    "marketing_campaign",
    "time_off_decision", "schedule_updated", "weekly_schedule",
  ];
  const replyTo = customerOrBarberFacing.includes(type)
    ? (data.shopEmail || undefined)
    : (data.replyTo || ADMIN_EMAIL);

  const sendArgs: Parameters<typeof resend.emails.send>[0] = { from: FROM, to, subject, html };
  if (replyTo) sendArgs.replyTo = replyTo;
  const { error } = await resend.emails.send(sendArgs);
  if (error) {
    // Never let an email fail silently — surface it to Vercel logs AND the CEO
    // error panel so a delivery problem (any type: barber invite, gift card,
    // receipt, …) is visible instead of guessed at. Best-effort logging.
    const msg = typeof error === "string" ? error : ((error as { message?: string })?.message ?? JSON.stringify(error));
    console.error("[email-send-failed]", JSON.stringify({ type, to, subject, error: msg }));
    supabaseAdmin.from("error_logs").insert({
      level: "error", source: "email",
      message: `Email failed (${type} → ${to}): ${msg}`.slice(0, 1000),
      path: `/email/${type}`,
    }).then(null, () => null);
    return { error };
  }
  return { success: true };
}
