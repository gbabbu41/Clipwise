import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAppEmail, PRIVILEGED_EMAIL_TYPES, SERVER_ONLY_EMAIL_TYPES } from "@/lib/emailer";
import { effectivePlan, isPaidPlan } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { authorizeShop } from "@/lib/api-auth";
import { requireSuperAdmin } from "@/lib/admin-auth";

// HTTP boundary for the shared email engine (src/lib/emailer.ts). This route's
// only extra job is the auth gate for privileged/abusable types so it can't be
// used as an open phishing/spam relay. Trusted server code (cron, webhooks,
// waitlist fan-out, Stripe finalize) calls sendAppEmail() DIRECTLY instead of
// going through here — no HTTP hop, no shared secret required.
export async function POST(req: NextRequest) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 });
  }

  // Volume cap on the whole email boundary — blunts any attempt to burn the
  // Resend quota / torch sender-domain reputation by looping this endpoint.
  const limited = enforceRateLimit(req, "send-email", 15, 60_000);
  if (limited) return limited;

  try {
    const body = await req.json();
    const { type, data } = body as { type: string; data: Record<string, string> };
    let emailData = data;
    if (type === "shop_approved" || type === "shop_rejected") {
      if (!(await requireSuperAdmin(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!data || typeof data.shopId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.shopId)) {
        return NextResponse.json({ error: "Invalid shop reference." }, { status: 400 });
      }
      const { data: savedShop, error } = await supabaseAdmin.from("shops")
        .select("id, name, slug, email, status, rejection_reason, users(name, email)")
        .eq("id", data.shopId).maybeSingle();
      if (error) return NextResponse.json({ error: "Unable to verify shop." }, { status: 503 });
      if (!savedShop) return NextResponse.json({ error: "Shop not found." }, { status: 404 });
      if (savedShop.status !== (type === "shop_approved" ? "approved" : "rejected")) {
        return NextResponse.json({ error: "Shop status changed; notification not sent." }, { status: 409 });
      }
      const owner = Array.isArray(savedShop.users) ? savedShop.users[0] : savedShop.users;
      const ownerEmail = owner?.email || savedShop.email;
      if (!ownerEmail) return NextResponse.json({ error: "Shop has no email recipient." }, { status: 400 });
      emailData = {
        shopName: savedShop.name ?? "", ownerName: owner?.name || "Shop Owner",
        ownerEmail, slug: savedShop.slug ?? "", reason: savedShop.rejection_reason ?? "",
      };
    }
    let reviewAuthorized = false;
    if (type === "review_request") {
      if (!data || typeof data.appointmentId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.appointmentId)) {
        return NextResponse.json({ error: "Invalid appointment reference." }, { status: 400 });
      }
      const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
      if (userError || !userData.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const { data: profile, error: profileError } = await supabaseAdmin.from("users")
        .select("role").eq("id", userData.user.id).maybeSingle();
      if (profileError) return NextResponse.json({ error: "Unable to verify access." }, { status: 503 });
      if (!profile || !["shop_owner", "barber", "super_admin"].includes(profile.role)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const { data: appt, error: apptError } = await supabaseAdmin.from("appointments")
        .select("id, shop_id, client_name, client_email, services(name), barbers(name)")
        .eq("id", data.appointmentId).maybeSingle();
      if (apptError) return NextResponse.json({ error: "Unable to verify appointment." }, { status: 503 });
      if (!appt) return NextResponse.json({ error: "Appointment not found." }, { status: 404 });
      let reviewShop: Record<string, unknown>;
      if (profile.role === "super_admin") {
        // Preserve this endpoint's existing verified platform-admin exception.
        const { data: savedShop, error: shopError } = await supabaseAdmin.from("shops")
          .select("id, name, email, slug, google_place_id").eq("id", appt.shop_id).maybeSingle();
        if (shopError) return NextResponse.json({ error: "Unable to verify shop." }, { status: 503 });
        if (!savedShop) return NextResponse.json({ error: "Shop not found." }, { status: 404 });
        reviewShop = savedShop;
      } else {
        // Same completion permission as appointments/update and loyalty/award.
        const auth = await authorizeShop(req, appt.shop_id, { permission: "manage_appointments" });
        if ("error" in auth) return auth.error;
        reviewShop = auth.shop;
      }
      if (!appt.client_email) return NextResponse.json({ error: "Appointment has no email recipient." }, { status: 400 });
      const service = Array.isArray(appt.services) ? appt.services[0] : appt.services;
      const barber = Array.isArray(appt.barbers) ? appt.barbers[0] : appt.barbers;
      const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca").replace(/\/+$/, "");
      emailData = {
        clientName: appt.client_name ?? "", clientEmail: appt.client_email,
        shopName: String(reviewShop.name ?? ""), shopEmail: String(reviewShop.email ?? ""),
        barberName: barber?.name ?? "Your barber", serviceName: service?.name ?? "Your service",
        reviewUrl: `${baseUrl}/book/${String(reviewShop.slug ?? "")}/review?booking=${appt.id}`,
        appointmentId: appt.id, googlePlaceId: String(reviewShop.google_place_id ?? ""),
      };
      reviewAuthorized = true;
    }
    // Browser messages must belong to this shop and a known recipient.
    // Birthday sends remain owner-only; direct messages also allow active staff.
    if (type === "birthday_wish" || type === "direct_message") {
      if (!data || typeof data.shopId !== "string" || typeof data.clientEmail !== "string" ||
          !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(data.clientEmail) || data.clientEmail.length > 254) {
        return NextResponse.json({ error: "Invalid client email request." }, { status: 400 });
      }
      if (type === "direct_message" && (typeof data.content !== "string" || !data.content.trim())) {
        return NextResponse.json({ error: "Message content is required." }, { status: 400 });
      }
      const auth = await authorizeShop(req, data.shopId, { ownerOnly: type === "birthday_wish" });
      if ("error" in auth) return auth.error;
      const email = data.clientEmail.toLowerCase();
      const pattern = email.replace(/[\\%_]/g, "\\$&");
      let recipient: { name: string; email: string } | null = null;
      // The existing directory also includes booking-only and POS-only clients.
      // Never create a client row just to send a greeting.
      for (const source of [
        { table: "clients", email: "email", name: "name" },
        { table: "appointments", email: "client_email", name: "client_name" },
        { table: "transactions", email: "client_email", name: "client_name" },
      ]) {
        const { data: rows, error } = await supabaseAdmin.from(source.table)
          .select(`${source.email}, ${source.name}`).eq("shop_id", auth.shop.id)
          .ilike(source.email, pattern).limit(1);
        if (error) return NextResponse.json({ error: "Unable to verify email recipient." }, { status: 503 });
        const row = rows?.[0] as unknown as Record<string, unknown> | undefined;
        const storedEmail = row?.[source.email];
        // Exact comparison also prevents PostgREST wildcard aliases from
        // selecting a different recipient, even if a crafted pattern matches.
        if (typeof storedEmail === "string" && storedEmail.toLowerCase() === email) {
          recipient = { email: storedEmail, name: typeof row?.[source.name] === "string" ? row[source.name] as string : "there" };
          break;
        }
      }
      if (!recipient) return NextResponse.json({ error: "Client not found in this shop." }, { status: 404 });
      // Birthday is a MARKETING email → carry a promos-only unsubscribe link. Needs
      // the client row's id; a booking-/POS-only contact with no clients row simply
      // gets no link (nothing to unsubscribe yet).
      let unsubscribeUrl = "";
      if (type === "birthday_wish") {
        const { data: cRow } = await supabaseAdmin.from("clients")
          .select("id").eq("shop_id", auth.shop.id).ilike("email", pattern).limit(1);
        const cid = cRow?.[0]?.id;
        if (cid) unsubscribeUrl = `${(process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca").replace(/\/+$/, "")}/api/unsubscribe?c=${cid}`;
      }
      emailData = {
        clientName: recipient.name, clientEmail: recipient.email,
        shopName: String(auth.shop.name ?? ""), shopEmail: String(auth.shop.email ?? ""),
        shopSlug: String(auth.shop.slug ?? ""),
        ...(unsubscribeUrl ? { unsubscribeUrl } : {}),
        ...(type === "direct_message" ? { content: data.content } : {}),
      };
    }
    // These notices are generated only by dedicated server workflows.
    // Even a staff account must not fabricate billing notices or signup codes.
    if (SERVER_ONLY_EMAIL_TYPES.has(type)) {
      return NextResponse.json({ error: "This notification is sent automatically." }, { status: 403 });
    }

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
    if (PRIVILEGED_EMAIL_TYPES.has(type) && !reviewAuthorized) {
      const internal = req.headers.get("x-internal-secret");
      const okInternal = !!process.env.CRON_SECRET && internal === process.env.CRON_SECRET;
      let okStaff = false;
      if (!okInternal) {
        const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (bearer) {
          const { data: { user } } = await supabaseAdmin.auth.getUser(bearer);
          // Being logged in is NOT enough — signup is free, so a plain customer
          // account could otherwise send branded payment_link / direct_message
          // phishing from our verified domain. Require a real shop role.
          if (user) {
            const { data: prof } = await supabaseAdmin.from("users").select("role").eq("id", user.id).maybeSingle();
            okStaff = prof?.role === "shop_owner" || prof?.role === "barber" || prof?.role === "super_admin";
          }
        }
      }
      if (!okInternal && !okStaff) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const result = await sendAppEmail(type, emailData);
    if ("error" in result) {
      // Unknown type is a client error; everything else is a send failure.
      const status = result.error === "Unknown email type" ? 400 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[send-email] failed:", err);
    return NextResponse.json({ error: "Failed to send email." }, { status: 500 });
  }
}
