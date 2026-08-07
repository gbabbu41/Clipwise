import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Stripe Terminal helpers (card-present / Tap to Pay), shared by the
 * /api/stripe/terminal/* routes.
 *
 * These are the platform-agnostic backend the native app (Capacitor) calls —
 * the SAME server code serves a Bluetooth reader (WisePad 3) AND Tap to Pay on
 * iPhone; only the native SDK connection differs. Nothing on the web calls
 * these, so they're dormant until the native shell + live Stripe exist.
 *
 * Charges run on each shop's CONNECTED account (0% platform fee — shop is
 * merchant of record), exactly like online booking and POS card sales.
 */

type ShopForLocation = {
  id: string;
  stripe_account_id?: string | null;
  stripe_terminal_location_id?: string | null;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
};

/**
 * Ensure the shop has a Stripe Terminal **Location** on its connected account
 * and return its id. A Location is required to connect Tap to Pay (and used to
 * group readers); a Bluetooth WisePad 3 can pair without one, so this is
 * best-effort and never throws — a missing shop address just yields null.
 *
 * Idempotent: reuses the cached id (phase41 column) when present, otherwise
 * reuses an existing Location with the same display name before creating one, so
 * it never spawns duplicates even before the cache column is migrated.
 */
export async function ensureTerminalLocation(shop: ShopForLocation): Promise<string | null> {
  if (shop.stripe_terminal_location_id) return shop.stripe_terminal_location_id;
  if (!shop.stripe_account_id) return null;
  const line1 = (shop.address ?? "").trim();
  if (!line1) return null; // Terminal Locations require a real street address.

  const acct = { stripeAccount: shop.stripe_account_id };
  const displayName = (shop.name?.trim().slice(0, 40) || "Shop");
  try {
    const list = await stripe.terminal.locations.list({ limit: 100 }, acct);
    let loc = list.data.find((l) => l.display_name === displayName) ?? null;
    if (!loc) {
      loc = await stripe.terminal.locations.create({
        display_name: displayName,
        address: {
          line1,
          city: shop.city ?? undefined,
          state: shop.province ?? undefined,
          postal_code: shop.postal_code ?? undefined,
          country: "CA",
        },
      }, acct);
    }
    // Cache for reuse — best-effort (the column may not exist pre-phase41).
    await supabaseAdmin.from("shops")
      .update({ stripe_terminal_location_id: loc.id })
      .eq("id", shop.id).then(null, () => null);
    return loc.id;
  } catch {
    return null;
  }
}
