import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.FROM_EMAIL ?? "onboarding@resend.dev";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "gbabbu41@gmail.com";
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

// ── Shared email wrapper ──────────────────────────────────────────────────────
function wrap(content: string) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#E5E7EB}
  .container{max-width:560px;margin:0 auto;padding:32px 16px}
  .card{background:#1C1C1E;border:1px solid #2D2D2D;border-radius:16px;padding:32px}
  .logo{font-size:22px;font-weight:800;color:#C9A84C;letter-spacing:-0.5px;margin-bottom:28px}
  .logo span{color:#fff}
  h1{font-size:22px;font-weight:700;color:#fff;margin:0 0 8px}
  p{font-size:14px;line-height:1.6;color:#9CA3AF;margin:0 0 12px}
  .highlight{color:#fff}
  .badge{display:inline-block;background:#C9A84C20;border:1px solid #C9A84C40;color:#C9A84C;font-size:12px;font-weight:600;padding:4px 12px;border-radius:999px;margin-bottom:20px}
  .btn{display:inline-block;background:#C9A84C;color:#000;font-weight:700;font-size:14px;padding:12px 28px;border-radius:10px;text-decoration:none;margin:16px 0}
  .link-box{background:#111;border:1px solid #2D2D2D;border-radius:10px;padding:12px 16px;margin:16px 0}
  .link-box a{color:#C9A84C;font-size:13px;text-decoration:none;word-break:break-all}
  .divider{border:0;border-top:1px solid #2D2D2D;margin:24px 0}
  .steps{list-style:none;padding:0;margin:16px 0}
  .steps li{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;font-size:14px;color:#9CA3AF}
  .step-num{background:#C9A84C20;border:1px solid #C9A84C40;color:#C9A84C;width:24px;height:24px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;margin-top:1px}
  .footer{text-align:center;margin-top:24px;font-size:12px;color:#4B5563}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2D2D2D;font-size:13px}
  .row:last-child{border-bottom:0}
  .row .label{color:#6B7280}
  .row .val{color:#fff;font-weight:500}
  .green-badge{display:inline-block;background:#10B98120;border:1px solid #10B98140;color:#10B981;font-size:12px;font-weight:600;padding:4px 12px;border-radius:999px;margin-bottom:20px}
  .red-badge{display:inline-block;background:#EF444420;border:1px solid #EF444440;color:#EF4444;font-size:12px;font-weight:600;padding:4px 12px;border-radius:999px;margin-bottom:20px}
</style></head>
<body><div class="container"><div class="card">${content}</div>
<div class="footer">© ClipWise · <a href="${BASE_URL}" style="color:#C9A84C;text-decoration:none">clipwise.ca</a></div>
</div></body></html>`;
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
    <a href="${BASE_URL}/login" class="btn" style="background:#1C1C1E;color:#C9A84C;border:1px solid #C9A84C40">Login to Dashboard →</a>
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
    <p>You are welcome to <a href="${BASE_URL}/onboarding" style="color:#C9A84C">reapply</a> after addressing the above. If you have any questions, please reply to this email.</p>
    <p style="color:#4B5563">— The ClipWise Team</p>
  `);
}

function reviewRequest(data: Record<string, string>) {
  const googleUrl = data.googlePlaceId
    ? `https://search.google.com/local/writereview?placeid=${data.googlePlaceId}`
    : null;
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
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
    <p style="color:#4B5563">— The ClipWise Team</p>
  `);
}

function appointmentReminder(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="badge">⏰ Appointment Tomorrow</div>
    <h1>See you tomorrow, ${data.clientName}!</h1>
    <p>This is a reminder for your appointment at <span class="highlight">${data.shopName}</span> tomorrow.</p>
    <hr class="divider">
    <div class="row"><span class="label">Booking ID</span><span class="val">${data.bookingId}</span></div>
    <div class="row"><span class="label">Barber</span><span class="val">${data.barberName}</span></div>
    <div class="row"><span class="label">Service</span><span class="val">${data.serviceName}</span></div>
    <div class="row"><span class="label">Date</span><span class="val">${data.date}</span></div>
    <div class="row"><span class="label">Time</span><span class="val">${data.time}</span></div>
    <div class="row"><span class="label">Total</span><span class="val">${data.total}</span></div>
    <hr class="divider">
    <p style="font-size:12px;color:#6B7280">Need to cancel? Please contact the shop as soon as possible.</p>
    <p style="color:#4B5563">— The ClipWise Team</p>
  `);
}

function bookingConfirmation(data: Record<string, string>) {
  const manageUrl = data.appointmentId ? `${BASE_URL}/my-booking/${data.appointmentId}` : null;
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="green-badge">✓ Booking Confirmed</div>
    <h1>Hi ${data.clientName},</h1>
    <p>Your appointment at <span class="highlight">${data.shopName}</span> is confirmed!</p>
    <hr class="divider">
    <div class="row"><span class="label">Booking ID</span><span class="val">${data.bookingId}</span></div>
    <div class="row"><span class="label">Shop</span><span class="val">${data.shopName}</span></div>
    <div class="row"><span class="label">Barber</span><span class="val">${data.barberName || "Any Available"}</span></div>
    <div class="row"><span class="label">Service</span><span class="val">${data.serviceName}</span></div>
    <div class="row"><span class="label">Date</span><span class="val">${data.date}</span></div>
    <div class="row"><span class="label">Time</span><span class="val">${data.time}</span></div>
    <div class="row"><span class="label">Total</span><span class="val">${data.total}</span></div>
    <hr class="divider">
    ${manageUrl ? `<a href="${manageUrl}" class="btn">View / Manage Booking →</a>
    <p style="font-size:12px;color:#4B5563;margin-top:8px">You can reschedule or cancel from the link above.</p>
    <hr class="divider">` : ""}
    <p style="color:#4B5563">— The ClipWise Team</p>
  `);
}

function rebookingReminder(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="badge">✂️ Time for a Fresh Cut?</div>
    <h1>Hey ${data.clientName}, it's been a while!</h1>
    <p>We haven't seen you at <span class="highlight">${data.shopName}</span> for a while. Your hair might be telling you something…</p>
    <p>Book your next appointment in seconds — no calls, no waiting.</p>
    <hr class="divider">
    <a href="${data.bookingUrl}" class="btn">Book Now →</a>
    ${data.promoNote ? `<p style="font-size:13px;color:#C9A84C;margin-top:12px">${data.promoNote}</p>` : ""}
    <hr class="divider">
    <p style="color:#4B5563">— ${data.shopName} via ClipWise</p>
  `);
}

function noShowFollowUp(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
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
    <div class="logo">Clip<span>Wise</span></div>
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
    <div class="logo">Clip<span>Wise</span></div>
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

function refundIssued(data: Record<string, string>) {
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
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
  const headline = approved ? "Your time off was approved" : "Your time off was denied";
  const badge = approved ? "✅ Time Off Approved" : "❌ Time Off Denied";
  return wrap(`
    <div class="logo">Clip<span>Wise</span></div>
    <div class="badge">${badge}</div>
    <h1>${headline}</h1>
    <p>${data.shopName} reviewed your time-off request.</p>
    <hr class="divider">
    <div class="row"><span class="label">Type</span><span class="val">${data.requestType}</span></div>
    <div class="row"><span class="label">Dates</span><span class="val">${data.dateRange}</span></div>
    ${data.timeRange ? `<div class="row"><span class="label">Hours</span><span class="val">${data.timeRange}</span></div>` : ""}
    <div class="row"><span class="label">Decision</span><span class="val" style="color:${approved ? "#10B981" : "#EF4444"};text-transform:uppercase;font-weight:600">${data.decision}</span></div>
    ${approved
      ? `<p style="color:#9CA3AF">Your schedule has been updated — these slots will no longer be offered to customers during this window.</p>`
      : `<p style="color:#9CA3AF">If you need to talk this through, message your shop directly.</p>`}
    <hr class="divider">
    <a href="${BASE_URL}/barber-dashboard/time-off" class="btn">View My Requests →</a>
    <p style="color:#4B5563">— The ClipWise Team</p>
  `);
}

function barberInvite(data: Record<string, string>) {
  const existing = data.existingAccount === "true";
  const ctaText = existing ? "Open My Barber Dashboard →" : "Accept Invite & Set Up Account →";
  const leadParagraph = existing
    ? `<p>Good news — you already have a ClipWise account. Click the button below to sign in instantly and start managing your schedule at <span class="highlight">${data.shopName}</span>.</p>
       <p style="font-size:13px;color:#9CA3AF;background:#1a1a1a;border:1px solid #2D2D2D;border-radius:8px;padding:12px 16px">
         The link below logs you in automatically.
         You can keep using your <strong style="color:#fff">existing ClipWise password</strong> to sign in normally any time at <a href="${BASE_URL}/login" style="color:#C9A84C">${BASE_URL}/login</a> — or
         <a href="${BASE_URL}/forgot-password" style="color:#C9A84C">reset your password</a> if you've forgotten it.
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

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { type, data } = body as { type: string; data: Record<string, string> };

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
      case "booking_confirmation":
        to = data.clientEmail;
        subject = `Booking Confirmed — ${data.shopName}`;
        html = bookingConfirmation(data);
        break;
      case "appointment_reminder":
        to = data.clientEmail;
        subject = `Reminder: Your appointment tomorrow at ${data.shopName}`;
        html = appointmentReminder(data);
        break;
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
      case "appointment_rejected":
        to = data.clientEmail;
        subject = `Your appointment at ${data.shopName} has been cancelled`;
        html = appointmentRejected(data);
        break;
      case "refund_issued":
        to = data.clientEmail;
        subject = `Refund issued — ${data.shopName}`;
        html = refundIssued(data);
        break;
      case "barber_invite":
        to = data.barberEmail;
        subject = `You're invited to join ${data.shopName} on ClipWise`;
        html = barberInvite(data);
        break;
      case "marketing_campaign":
        to = data.to;
        subject = data.subject;
        html = data.htmlBody;
        break;
      default:
        return NextResponse.json({ error: "Unknown email type" }, { status: 400 });
    }

    // ── Reply-To routing ────────────────────────────────────────────────────
    // The "From" address (hello@clipwise.ca) has no inbox, so a Reply-To is
    // needed for replies to land somewhere a human reads. Route by type:
    //  · Customer/barber-facing → shop owner ONLY. Never the platform admin
    //    (would expose ADMIN_EMAIL to the public). If shop email is somehow
    //    missing, omit replyTo so the reply bounces to From rather than us.
    //  · Owner-facing + admin emails → platform admin is appropriate.
    const customerOrBarberFacing = [
      "booking_confirmation", "appointment_reminder", "review_request",
      "appointment_rejected", "refund_issued", "rebooking_reminder",
      "no_show_followup", "birthday_wish",
      "barber_invite", "new_booking_barber",
    ];
    const replyTo = customerOrBarberFacing.includes(type)
      ? (data.shopEmail || undefined)
      : (data.replyTo || ADMIN_EMAIL);

    const sendArgs: Parameters<typeof resend.emails.send>[0] = { from: FROM, to, subject, html };
    if (replyTo) sendArgs.replyTo = replyTo;
    const { error } = await resend.emails.send(sendArgs);
    if (error) return NextResponse.json({ error }, { status: 400 });

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
