import Stripe from "stripe";

// Server-only — never import in "use client" components
// (apiVersion omitted → uses the SDK's pinned default)
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Monthly subscription pricing (in cents, CAD)
export const PLAN_PRICING: Record<string, { amount: number; name: string }> = {
  pro: { amount: 2300, name: "ClipWise Pro" },
  premium: { amount: 4900, name: "ClipWise Premium" },
};
