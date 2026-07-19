import Stripe from "stripe";

// Server-only — never import in "use client" components
// (apiVersion omitted → uses the SDK's pinned default)
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/**
 * True when running on LIVE Stripe keys (real money). Used to gate the
 * platform-charge fallback: in test/sandbox we let an un-onboarded shop fall
 * back to a platform charge so demos work without KYC, but with real money we
 * must NEVER do that — block online payment until the shop completes Connect,
 * otherwise the customer is charged and the funds land in the platform account
 * instead of the shop's.
 */
export const STRIPE_LIVE_MODE = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_");

// Monthly subscription pricing (in cents, CAD)
export const PLAN_PRICING: Record<string, { amount: number; name: string }> = {
  pro: { amount: 2300, name: "ClipWise Pro" },
  premium: { amount: 7900, name: "ClipWise Premium" },
};
