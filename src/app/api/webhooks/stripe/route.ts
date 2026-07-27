import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendPaymentReceipt, notifyNoShowCharged, notifyDuplicatePayment, notifyRefundIssued } from "@/lib/payment-notify";
import { recordOnlinePaymentTx } from "@/lib/finalize-appointment-payment";
import { finalizeBookingFromSession } from "@/lib/finalize-booking-session";
import { insertNotifications } from "@/lib/notify";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { getLocationLimit } from "@/lib/validation";
import { reconcileLocationAddon } from "@/lib/stripe-addons";

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

        // ── Post-visit tip ─────────────────────────────────────────────────────
        // A customer left a tip via their tip link. Purely additive: record the
        // tip transaction + bump the appointment's tip total + notify the shop.
        if (session.metadata?.flow === "tip" && session.metadata?.appointment_id) {
          const apptId = session.metadata.appointment_id;
          const tipDollars = Number(session.metadata.tip_amount ?? 0);
          const tipPi = typeof session.payment_intent === "string" ? session.payment_intent : null;
          if (tipDollars > 0 && tipPi) {
            const { data: dup } = await supabaseAdmin.from("transactions").select("id").eq("payment_intent_id", tipPi).limit(1);
            if ((dup?.length ?? 0) === 0) {
              await recordOnlinePaymentTx({
                appointmentId: apptId,
                shopId: session.metadata.shop_id,
                barberId: session.metadata.barber_id || null,
                clientName: session.metadata.client_name || null,
                serviceName: "Tip",
                amountDollars: 0,
                tipDollars,
                paymentIntentId: tipPi,
              });
              const { data: cur } = await supabaseAdmin.from("appointments").select("tip_amount").eq("id", apptId).maybeSingle();
              if (cur) {
                await supabaseAdmin.from("appointments")
                  .update({ tip_amount: Number(cur.tip_amount ?? 0) + tipDollars }).eq("id", apptId).then(null, () => null);
              }
              const { data: tipShop } = await supabaseAdmin.from("shops").select("owner_id").eq("id", session.metadata.shop_id).maybeSingle();
              if (tipShop?.owner_id) {
                insertNotifications({
                  user_id: tipShop.owner_id, shop_id: session.metadata.shop_id, title: "Tip received",
                  message: `${session.metadata.client_name || "A customer"} left a $${tipDollars.toFixed(2)} tip. 🎉`,
                  type: "system",
                });
              }
            }
          }
          break;
        }

        // Post-booking payment link flow — owner sent a payment link for an
        // existing appointment and the customer just paid. Flip the row.
        if (session.metadata?.flow === "post_booking_payment" && session.metadata?.appointment_id) {
          const apptId = session.metadata.appointment_id;
          const newPi = typeof session.payment_intent === "string" ? session.payment_intent : null;
          // Checkout-flow link → paying it finishes the visit (status completed).
          const completeOnPaid = session.metadata?.complete_on_paid === "1";

          // ── Double-payment guard ─────────────────────────────────────────────
          // The appointment was already settled before this online payment landed.
          // Two cases, handled differently (per shop preference):
          //   · CARD charged twice (existing has a real payment_intent that differs
          //     from this one) → unambiguous duplicate → AUTO-REFUND this charge.
          //   · Online over a CASH/offline record (no existing payment_intent) →
          //     the cash entry might be wrong, so DON'T auto-refund — just alert
          //     the barber/owner to review and refund manually if needed.
          // A legit single online payment shares the same payment_intent
          // (samePayment) and is left to the normal transition below.
          const { data: existing } = await supabaseAdmin
            .from("appointments")
            .select("payment_status, payment_method, payment_intent_id, client_email, client_name, date, total_amount, shop_id, barber_id, services(name)")
            .eq("id", apptId)
            .maybeSingle();
          const alreadyPaid = !!existing && (existing.payment_status === "paid" || existing.payment_status === "captured");
          const samePayment = !!existing?.payment_intent_id && !!newPi && existing.payment_intent_id === newPi;
          const dupCard = alreadyPaid && !!existing!.payment_intent_id && !!newPi && existing!.payment_intent_id !== newPi;
          const onlineOverCash = alreadyPaid && !existing!.payment_intent_id && !samePayment;
          if (dupCard || onlineOverCash) {
            const { data: shopRow } = await supabaseAdmin
              .from("shops").select("name, email, slug, owner_id, stripe_account_id").eq("id", existing!.shop_id).maybeSingle();
            const dupSvc = Array.isArray(existing!.services)
              ? (existing!.services[0]?.name ?? "Your service")
              : ((existing!.services as { name?: string } | null)?.name ?? "Your service");
            const amountCents = Math.round((existing!.total_amount ?? 0) * 100);

            let mode: "auto_refunded" | "refund_failed" | "review" = "review";
            if (dupCard) {
              mode = "refund_failed";
              if (newPi && shopRow?.stripe_account_id) {
                try {
                  await stripe.refunds.create({ payment_intent: newPi }, { stripeAccount: shopRow.stripe_account_id });
                  mode = "auto_refunded";
                } catch { /* leave as refund_failed — owner alerted to do it manually */ }
              }
              // Tell the customer only when we actually refunded.
              if (mode === "auto_refunded" && existing!.client_email) {
                await fetch(`${BASE_URL}/api/send-email`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    type: "refund_issued",
                    data: {
                      clientName: existing!.client_name,
                      clientEmail: existing!.client_email,
                      shopName: shopRow?.name ?? "",
                      shopEmail: shopRow?.email ?? "",
                      shopSlug: shopRow?.slug ?? "",
                      serviceName: dupSvc,
                      date: existing!.date,
                      total: `$${(existing!.total_amount ?? 0).toFixed(2)}`,
                    },
                  }),
                }).catch(() => null);
              }
            }
            await notifyDuplicatePayment({
              ownerId: shopRow?.owner_id ?? null,
              barberId: existing!.barber_id ?? null,
              shopId: existing!.shop_id ?? null,
              clientName: existing!.client_name,
              amountCents,
              date: existing!.date,
              mode,
            });
            break;
          }

          const { data: paidAppt } = await supabaseAdmin
            .from("appointments")
            .update({
              payment_status: "paid",
              payment_method: "online",
              paid_at: new Date().toISOString(),
              payment_intent_id: newPi,
              // Checkout-flow link finishes the visit → completed.
              ...(completeOnPaid ? { status: "completed" } : {}),
            })
            .eq("id", apptId)
            .neq("payment_status", "paid") // only the real unpaid→paid transition (avoids double receipt vs payment-link-finalize)
            .select("client_email, client_name, date, time_slot, total_amount, shop_id, barber_id, services(name)")
            .maybeSingle();

          // A pay-in-person booking that's still awaiting approval is now paid —
          // auto-confirm it (status-scoped so a completed/cancelled row is never
          // regressed). Mirrors markAppointmentPaid for the customer-return path.
          // Skipped for the checkout flow, which already set it to completed above.
          if (!completeOnPaid) {
            await supabaseAdmin.from("appointments")
              .update({ status: "confirmed" })
              .eq("id", session.metadata.appointment_id)
              .eq("status", "pending")
              .then(null, () => null);
          }

          // Only fire notifications + receipt on the real transition (paidAppt is
          // null when the row was already paid, e.g. payment-link-finalize got there
          // first — prevents double-notifying).
          if (paidAppt) {
            const { data: shopRow } = await supabaseAdmin
              .from("shops").select("name, email, owner_id").eq("id", paidAppt.shop_id).maybeSingle();
            const svcName = Array.isArray(paidAppt.services)
              ? (paidAppt.services[0]?.name ?? "")
              : ((paidAppt.services as { name?: string } | null)?.name ?? "");

            // Ledger row so the barber portal + analytics see the online payment
            // (idempotent — payment-link-finalize may have written it already).
            await recordOnlinePaymentTx({
              appointmentId: apptId,
              shopId: paidAppt.shop_id,
              barberId: paidAppt.barber_id ?? null,
              clientName: paidAppt.client_name,
              serviceName: svcName || "Service",
              amountDollars: Number(paidAppt.total_amount ?? 0),
              paymentIntentId: newPi,
            });

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
              shopId: paidAppt.shop_id ?? null,
              clientName: paidAppt.client_name,
              amountCents: Math.round((paidAppt.total_amount ?? 0) * 100),
              date: paidAppt.date,
              kind: "completed",
            });

            // Owner email — the off-app alert. A payment link is usually paid
            // when the owner isn't in the app, so the realtime chime can't reach
            // them; the in-app notification only surfaces on next open. The
            // finalize/reconcile paths already send this, but the webhook (the
            // primary path when Stripe delivers the event) was the one paid path
            // that skipped it. The .neq("payment_status","paid") claim above
            // means only ONE path wins the transition, so there's no double send.
            if (shopRow?.email) {
              fetch(`${BASE_URL}/api/send-email`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  type: "owner_payment_received",
                  data: {
                    ownerEmail: shopRow.email,
                    clientName: paidAppt.client_name ?? "A client",
                    serviceName: svcName || "Service",
                    amount: `$${(paidAppt.total_amount ?? 0).toFixed(2)}`,
                    date: paidAppt.date,
                    time: paidAppt.time_slot,
                  },
                }),
              }).catch(() => null);
            }
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
          // Re-attach the $30/location add-on onto the new subscription (a plan
          // change makes a fresh sub, so the add-on item doesn't carry over).
          if (newSubId && userId && plan) {
            await ensurePlansHydrated();
            const { count } = await supabaseAdmin.from("shops").select("id", { count: "exact", head: true }).eq("owner_id", userId);
            const included = getLocationLimit(plan);
            await reconcileLocationAddon(newSubId, Math.max(0, (count ?? 0) - included)).catch(() => {});
          }
        } else if (session.metadata?.shop_id && session.metadata?.date && session.metadata?.time_slot) {
          // ── New online booking, FALLBACK creation ────────────────────────────
          // A pay/hold/save booking normally becomes an appointment when the
          // customer returns to /booking-finalize. If they close the tab first,
          // this is the safety net so a paid booking is never lost. Fully
          // idempotent — if the return path already created it, this dedupes and
          // does nothing (and never reverses money for the same-session race).
          const { data: bShop } = await supabaseAdmin
            .from("shops").select("stripe_account_id, stripe_connected").eq("id", session.metadata.shop_id).maybeSingle();
          if (bShop) {
            const bUseConnect = !!(bShop.stripe_account_id && bShop.stripe_connected);
            const result = await finalizeBookingFromSession({
              session, useConnect: bUseConnect, stripeAccountId: bShop.stripe_account_id ?? null, baseUrl: BASE_URL,
            });
            if (result.status === "error" || result.status === "conflict") {
              console.warn("[webhook] booking fallback", result.status, result.message);
            }
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
        // 'saved' included: a saved-card booking charged off-session fires this event.
        await supabaseAdmin.from("appointments")
          .update({ payment_status: "paid", paid_at: new Date().toISOString() })
          .eq("payment_intent_id", pi.id)
          .in("payment_status", ["unpaid", "held", "saved", "failed"]);
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
            insertNotifications({
              user_id: shop.owner_id,
              shop_id: appt.shop_id,
              title: "Payment Failed",
              message: `A payment from ${appt.client_name ?? "a client"} failed.`,
              type: "system",
            });
          }
        }
        break;
      }
      // ── Charge refunded (in-app Refund OR straight in the Stripe dashboard) ──
      // Sync our records so the row greys out + drops from Collected, keeping us
      // in step with Stripe's payout balance. Connect refunds arrive here too
      // (same endpoint that gets account.updated). Full refunds only — a partial
      // refund leaves the row as-is so we don't mislabel it.
      case "charge.refunded": {
        const ch = event.data.object as Stripe.Charge;
        const pi = typeof ch.payment_intent === "string"
          ? ch.payment_intent
          : (ch.payment_intent?.id ?? null);
        if (pi && ch.refunded) {
          // Only rows this event actually flips (were not already refunded) get
          // notified — so an in-app refund (which already set refunded + notified
          // in the route) doesn't double-notify; only dashboard-initiated refunds
          // land here fresh.
          const { data: flipped } = await supabaseAdmin.from("appointments")
            .update({ payment_status: "refunded" })
            .eq("payment_intent_id", pi)
            .neq("payment_status", "refunded")
            .select("shop_id, barber_id, client_name, total_amount, date")
            .maybeSingle();
          await supabaseAdmin.from("transactions")
            .update({ refunded: true })
            .eq("payment_intent_id", pi)
            .then(null, () => null);
          if (flipped) {
            const { data: refShop } = await supabaseAdmin.from("shops").select("owner_id").eq("id", flipped.shop_id).maybeSingle();
            notifyRefundIssued({
              ownerId: refShop?.owner_id ?? null,
              barberId: flipped.barber_id ?? null,
              shopId: flipped.shop_id ?? null,
              clientName: flipped.client_name,
              amountCents: Math.round((flipped.total_amount ?? 0) * 100),
              date: flipped.date,
            });
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
