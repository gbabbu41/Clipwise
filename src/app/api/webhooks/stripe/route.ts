import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendPaymentReceipt, notifyNoShowCharged } from "@/lib/payment-notify";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

export async function POST(request: NextRequest) {
  // Trim — a stray space in the env value silently breaks signature checks.
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });

  const body = await request.text();
  const sig = request.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "No signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    return NextResponse.json({ error: `Signature verification failed: ${err instanceof Error ? err.message : ""}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      // ── Checkout finished ──────────────────────────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // Post-booking payment link flow — owner sent a payment link for an
        // existing appointment and the customer just paid. Flip the row.
        if (session.metadata?.flow === "post_booking_payment" && session.metadata?.appointment_id) {
          const { data: paidAppt } = await supabaseAdmin
            .from("appointments")
            .update({
              payment_status: "paid",
              payment_method: "online",
              paid_at: new Date().toISOString(),
              payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
            })
            .eq("id", session.metadata.appointment_id)
            .neq("payment_status", "paid") // only the real unpaid→paid transition (avoids double receipt vs payment-link-finalize)
            .select("client_email, client_name, date, total_amount, shop_id, barber_id, services(name)")
            .maybeSingle();

          // A pay-in-person booking that's still awaiting approval is now paid —
          // auto-confirm it (status-scoped so a completed/cancelled row is never
          // regressed). Mirrors markAppointmentPaid for the customer-return path.
          await supabaseAdmin.from("appointments")
            .update({ status: "confirmed" })
            .eq("id", session.metadata.appointment_id)
            .eq("status", "pending")
            .then(null, () => null);

          // Only fire notifications + receipt on the real transition (paidAppt is
          // null when the row was already paid, e.g. payment-link-finalize got there
          // first — prevents double-notifying).
          if (paidAppt) {
            const { data: shopRow } = await supabaseAdmin
              .from("shops").select("name, email, owner_id").eq("id", paidAppt.shop_id).maybeSingle();
            const svcName = Array.isArray(paidAppt.services)
              ? (paidAppt.services[0]?.name ?? "")
              : ((paidAppt.services as { name?: string } | null)?.name ?? "");

            // Customer receipt
            if (paidAppt.client_email) {
              await sendPaymentReceipt(BASE_URL, {
                clientEmail: paidAppt.client_email,
                clientName: paidAppt.client_name,
                shopName: shopRow?.name,
                shopEmail: shopRow?.email,
                serviceName: svcName,
                date: paidAppt.date,
                amountCents: Math.round((paidAppt.total_amount ?? 0) * 100),
                context: "Payment received",
              });
            }

            // Owner + barber in-app notification + chime. Uses same helper as
            // capture-appointment so the realtime pop-up fires for both portals.
            notifyNoShowCharged({
              ownerId: shopRow?.owner_id ?? null,
              barberId: paidAppt.barber_id ?? null,
              clientName: paidAppt.client_name,
              amountCents: Math.round((paidAppt.total_amount ?? 0) * 100),
              date: paidAppt.date,
              kind: "completed",
            });
          }
          break;
        }

        if (session.mode === "subscription") {
          const userId = session.metadata?.user_id;
          const plan = session.metadata?.plan;
          const oldSubId = session.metadata?.old_subscription_id;
          const newSubId = typeof session.subscription === "string" ? session.subscription : null;
          if (userId) {
            await supabaseAdmin.from("shops").update({
              stripe_customer_id: typeof session.customer === "string" ? session.customer : null,
              stripe_subscription_id: newSubId,
              subscription_status: "active",
              ...(plan ? { subscription_plan: plan } : {}),
            }).eq("owner_id", userId);
          }
          // On upgrade, cancel the previous subscription so they aren't billed twice
          if (oldSubId && oldSubId !== newSubId) {
            await stripe.subscriptions.cancel(oldSubId).catch(() => null);
          }
        }
        break;
      }

      // ── Subscription changed (plan switch, renewal, past_due) ────────────────
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const statusMap: Record<string, string> = {
          active: "active", trialing: "active",
          past_due: "past_due", unpaid: "past_due",
          canceled: "cancelled", incomplete_expired: "cancelled",
        };
        await supabaseAdmin.from("shops")
          .update({ subscription_status: statusMap[sub.status] ?? "inactive" })
          .eq("stripe_subscription_id", sub.id);
        break;
      }

      // ── Subscription cancelled → downgrade to starter + email ────────────────
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const { data: shop } = await supabaseAdmin.from("shops")
          .select("id, name, email").eq("stripe_subscription_id", sub.id).maybeSingle();
        if (shop) {
          await supabaseAdmin.from("shops")
            .update({ subscription_status: "cancelled", subscription_plan: "starter" })
            .eq("id", shop.id);
          if (shop.email) {
            fetch(`${BASE_URL}/api/send-email`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "subscription_cancelled", data: { shopName: shop.name, ownerEmail: shop.email } }),
            }).catch(() => null);
          }
        }
        break;
      }

      // ── Connect account status changed ───────────────────────────────────────
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        const active = account.charges_enabled && account.payouts_enabled;
        await supabaseAdmin.from("shops")
          .update({ stripe_connected: !!active, stripe_connect_status: active ? "active" : "pending" })
          .eq("stripe_account_id", account.id);
        break;
      }

      // ── Booking payment succeeded (backup to finalize route) ─────────────────
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        // Only promote a not-yet-settled booking to paid. Without this filter a
        // captured no-show fee (status 'captured', partial amount) — whose
        // capture also fires this event — would be overwritten to 'paid',
        // losing the no-show distinction. Leave captured/paid/refunded alone.
        await supabaseAdmin.from("appointments")
          .update({ payment_status: "paid", paid_at: new Date().toISOString() })
          .eq("payment_intent_id", pi.id)
          .in("payment_status", ["unpaid", "held", "failed"]);
        break;
      }

      // ── Booking payment failed → flag + notify owner ─────────────────────────
      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const { data: appt } = await supabaseAdmin.from("appointments")
          .update({ payment_status: "failed" })
          .eq("payment_intent_id", pi.id)
          .select("shop_id, client_name").maybeSingle();
        if (appt?.shop_id) {
          const { data: shop } = await supabaseAdmin.from("shops").select("owner_id").eq("id", appt.shop_id).single();
          if (shop?.owner_id) {
            supabaseAdmin.from("notifications").insert({
              user_id: shop.owner_id,
              title: "Payment Failed",
              message: `A payment from ${appt.client_name ?? "a client"} failed.`,
              type: "system",
              is_read: false,
            }).then(null, () => null);
          }
        }
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Handler error" }, { status: 500 });
  }
}
