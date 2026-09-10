import { NextRequest, NextResponse } from "next/server";
import { withdrawPromoConsent } from "@/lib/consent";

// One-click email unsubscribe. The link in a marketing email points here with
// ?c=<client_id> (an unguessable UUID).
//
// The actual opt-out is a POST, not a GET: a GET with a side effect gets
// auto-fetched by inbox link-scanners (Outlook SafeLinks, antivirus, Gmail
// proxy), which would silently unsubscribe people who never clicked. So GET
// renders a confirm button; POST performs the withdrawal (RFC 8058 one-click
// clients POST here directly). Always renders a friendly page and never leaks
// whether the id existed. Email unsubscribe withdraws PROMOS only — it never
// touches transactional appointment reminders.

function shell(inner: string): NextResponse {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe · ClipWise</title></head>
<body style="margin:0;background:#000;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;">
<div style="text-align:center;padding:32px;max-width:420px;">${inner}</div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function confirmPage(clientId: string): NextResponse {
  const safeId = encodeURIComponent(clientId);
  return shell(`
    <div style="font-size:40px;margin-bottom:12px;">✉️</div>
    <h1 style="font-size:20px;font-weight:800;margin:0 0 8px;">Unsubscribe from marketing?</h1>
    <p style="color:#999;font-size:14px;margin:0 0 20px;">You'll stop getting offers &amp; promotions. You can still book anytime, and you'll still get reminders for appointments you make.</p>
    <form method="POST" action="/api/unsubscribe?c=${safeId}">
      <button type="submit" style="background:#ef4444;color:#fff;border:0;border-radius:9999px;font-weight:700;font-size:15px;padding:12px 28px;cursor:pointer;">Unsubscribe</button>
    </form>`);
}

function donePage(): NextResponse {
  return shell(`
    <div style="font-size:40px;margin-bottom:12px;">✅</div>
    <h1 style="font-size:20px;font-weight:800;margin:0 0 8px;">You're unsubscribed</h1>
    <p style="color:#999;font-size:14px;margin:0;">You can still book appointments anytime — this only stops marketing.</p>`);
}

export async function GET(req: NextRequest) {
  const clientId = new URL(req.url).searchParams.get("c");
  // GET never mutates — show a confirm button (or the done page if there's no id).
  return clientId ? confirmPage(clientId) : donePage();
}

export async function POST(req: NextRequest) {
  const clientId = new URL(req.url).searchParams.get("c");
  if (clientId) {
    await withdrawPromoConsent([clientId], { source: "email_unsubscribe" });
  }
  return donePage();
}
