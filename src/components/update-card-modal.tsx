"use client";
import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { X, CreditCard, ShieldCheck } from "lucide-react";

// NEXT_PUBLIC_ vars are inlined at BUILD time. If the key isn't set, the whole
// in-app flow is disabled and the Billing page keeps the Stripe-portal fallback —
// so nothing breaks before the owner adds the env var.
const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
export const stripeElementsEnabled = !!PK;
const stripePromise = PK ? loadStripe(PK) : null;

function CardForm({ accessToken, shopId, onClose, onSaved }: {
  accessToken: string; shopId?: string | null;
  onClose: () => void; onSaved: (last4: string | null) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Match the card field to the active portal theme via the app's CSS tokens.
  const [colors] = useState(() => {
    if (typeof document === "undefined") return { text: "#e5e5e5", placeholder: "#8f8f8f" };
    const cs = getComputedStyle(document.body);
    return {
      text: cs.getPropertyValue("--foreground").trim() || "#e5e5e5",
      placeholder: cs.getPropertyValue("--grey").trim() || "#8f8f8f",
    };
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setErr(""); setBusy(true);
    try {
      // 1) Ask the server for a SetupIntent (attached to the shop's customer).
      const siRes = await fetch("/api/stripe/setup-intent", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
      const si = await siRes.json().catch(() => ({}));
      if (!siRes.ok || !si.clientSecret) { setErr(si.error || "Couldn't start the update."); setBusy(false); return; }

      // 2) Confirm the card straight with Stripe — the number never hits our server.
      const card = elements.getElement(CardElement);
      if (!card) { setErr("Card field isn't ready — try again."); setBusy(false); return; }
      const { error, setupIntent } = await stripe.confirmCardSetup(si.clientSecret, { payment_method: { card } });
      if (error) { setErr(error.message || "Your card couldn't be saved."); setBusy(false); return; }
      const pm = setupIntent?.payment_method;
      const pmId = typeof pm === "string" ? pm : pm?.id;
      if (!pmId) { setErr("Couldn't read the saved card — try again."); setBusy(false); return; }

      // 3) Make it the default for the subscription's future renewals.
      const upRes = await fetch("/api/stripe/update-card", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ payment_method: pmId, shop_id: shopId }),
      });
      const up = await upRes.json().catch(() => ({}));
      if (!upRes.ok || !up.ok) { setErr(up.error || "Couldn't save the card."); setBusy(false); return; }
      onSaved(up.last4 ?? null);
    } catch {
      setErr("Something went wrong — please try again.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-xl border border-border bg-card-raised px-3.5 py-3.5">
        <CardElement options={{
          style: {
            base: { color: colors.text, fontSize: "16px", "::placeholder": { color: colors.placeholder } },
            invalid: { color: "#ff6b6b" },
          },
        }} />
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" className="flex-1" loading={busy} disabled={!stripe}>Save card</Button>
      </div>
      <p className="text-[11px] text-grey flex items-center gap-1.5">
        <ShieldCheck size={13} className="text-emerald-400 flex-shrink-0" />
        Sent directly to Stripe, encrypted — your card never touches ClipWise.
      </p>
    </form>
  );
}

/** In-app "Update card" modal. Renders nothing (returns null) when the
 *  publishable key is absent, so callers can gate on `stripeElementsEnabled`. */
export function UpdateCardModal({ accessToken, shopId, onClose, onSaved }: {
  accessToken: string; shopId?: string | null;
  onClose: () => void; onSaved: (last4: string | null) => void;
}) {
  if (!stripePromise) return null;
  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain">
        <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md my-auto">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><CreditCard size={18} /> Update card</h2>
            <button onClick={onClose} aria-label="Close" className="text-grey hover:text-foreground"><X size={18} /></button>
          </div>
          <p className="text-xs text-grey mb-4">This is the card charged for your ClipWise plan going forward.</p>
          <Elements stripe={stripePromise}>
            <CardForm accessToken={accessToken} shopId={shopId} onClose={onClose} onSaved={onSaved} />
          </Elements>
        </div>
      </div>
    </>
  );
}
