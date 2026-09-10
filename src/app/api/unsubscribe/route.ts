import { NextRequest, NextResponse } from "next/server";
import { withdrawPromoConsent } from "@/lib/consent";

// One-click email unsubscribe. The link in a marketing email points here with
// ?c=<client_id> (an unguessable UUID). We record a permanent promo-consent
// withdrawal (CASL) and return a tiny confirmation page — no login required, so
// it works straight from an inbox. Always renders a friendly page (never leaks
// whether the id existed). Email unsubscribe doesn't touch SMS reminders.
function page(msg: string): NextResponse {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe · ClipWise</title></head>
<body style="margin:0;background:#000;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;">
<div style="text-align:center;padding:32px;max-width:420px;">
<div style="font-size:40px;margin-bottom:12px;">✅</div>
<h1 style="font-size:20px;font-weight:800;margin:0 0 8px;">${msg}</h1>
<p style="color:#999;font-size:14px;margin:0;">You can still book appointments anytime — this only stops marketing emails.</p>
</div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  const clientId = new URL(req.url).searchParams.get("c");
  if (clientId) {
    await withdrawPromoConsent([clientId]);
  }
  return page("You're unsubscribed");
}
