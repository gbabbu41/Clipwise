import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAppEmail, PRIVILEGED_EMAIL_TYPES } from "@/lib/emailer";
import { effectivePlan, isPaidPlan } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";

// HTTP boundary for the shared email engine (src/lib/emailer.ts). This route's
// only extra job is the auth gate for privileged/abusable types so it can't be
// used as an open phishing/spam relay. Trusted server code (cron, webhooks,
// waitlist fan-out, Stripe finalize) calls sendAppEmail() DIRECTLY instead of
// going through here — no HTTP hop, no shared secret required.
export async function POST(req: NextRequest) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { type, data } = body as { type: string; data: Record<string, string> };

    // Marketing blasts are a PAID feature (Pro + Premium) — being logged in isn't
    // enough. Require the caller to own an active paid shop (internal cron/webhook
    // calls with the shared secret are exempt). This runs before the generic
    // privileged-type gate below.
    if (type === "marketing_campaign") {
      const internal = req.headers.get("x-internal-secret");
      const okInternal = !!process.env.CRON_SECRET && internal === process.env.CRON_SECRET;
      if (!okInternal) {
        const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        let paid = false;
        if (bearer) {
          const { data: { user } } = await supabaseAdmin.auth.getUser(bearer);
          if (user) {
            await ensurePlansHydrated();
            const { data: shops } = await supabaseAdmin
              .from("shops").select("subscription_plan, subscription_status").eq("owner_id", user.id);
            paid = (shops ?? []).some((s) =>
              isPaidPlan(effectivePlan(s.subscription_plan ?? undefined, s.subscription_status ?? undefined)));
          }
        }
        if (!paid) return NextResponse.json({ error: "Marketing campaigns are available on the Pro and Premium plans." }, { status: 403 });
      }
    }

    // Gate the abusable types so /api/send-email can't be used as an open
    // phishing/spam relay (arbitrary HTML/recipient or a login/invite link).
    if (PRIVILEGED_EMAIL_TYPES.has(type)) {
      const internal = req.headers.get("x-internal-secret");
      const okInternal = !!process.env.CRON_SECRET && internal === process.env.CRON_SECRET;
      let okUser = false;
      if (!okInternal) {
        const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (bearer) {
          const { data: { user } } = await supabaseAdmin.auth.getUser(bearer);
          okUser = !!user;
        }
      }
      if (!okInternal && !okUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await sendAppEmail(type, data);
    if ("error" in result) {
      // Unknown type is a client error; everything else is a send failure.
      const status = result.error === "Unknown email type" ? 400 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
