// Single source of truth for how plans are PRESENTED (the marketing cards) across
// the whole app — the public home page, signup/onboarding, and the in-app billing
// & settings "change plan" screens all render from this ONE list. Edit here once
// and every plan card in the app updates together, with no drift between screens.
//
// Division of responsibility (important):
//   • The DB `plans` table (see lib/plans + lib/validation) stays the source of
//     truth for the FUNCTIONAL facts that touch money — price_cents, barber_limit,
//     and which features are gated. That drives Stripe billing + access control.
//   • THIS file owns the copy only: which bullets read as included (`yes`) vs.
//     not-included (`no` — the honest limitations), the one-line "who it's for"
//     tagline, which tier is spotlighted (`pop`), and the CTA wording.
//
// Keyed by plan id so a card can merge these bullets onto its live DB row (price,
// limits) — standard tiers get the rich presentation; a custom plan the admin adds
// (no entry here) falls back to its DB highlights.

export interface PlanMarketing {
  n: string;        // display name
  plan: string;     // plan id — must match plans.id in the DB
  p: string;        // price label, display only (DB price_cents is the billing truth)
  per: string;      // "/mo" | "forever"
  forWho: string;   // one-line "who this is for"
  pop: boolean;     // spotlight this tier — the recommended / "most popular" pick
  yes: string[];    // included → green check
  no: string[];     // NOT included → grey ✕ (the limitations, shown honestly)
  cta: string;      // button label (home page)
}

export const PLAN_MARKETING: PlanMarketing[] = [
  { n: "Starter", plan: "starter", p: "Free", per: "forever", forWho: "For a solo barber starting out", pop: false, yes: ["1 barber", "Online booking page", "Appointment management", "Email confirmations & reminders"], no: ["SMS / text alerts", "Reviews & loyalty", "Marketing & analytics", "Walk-in & waitlist", "Customer payments", "POS system"], cta: "Get started free" },
  { n: "Pro", plan: "pro", p: "$23", per: "/mo", forWho: "For solo barbers & small shops — add a shop anytime", pop: true, yes: ["21-day free trial — no card", "Up to 4 barbers", "Online booking + payments", "In-person POS (cash & card)", "SMS reminders & alerts", "Reviews, loyalty & marketing", "Walk-in & waitlist", "Tips, tax & analytics", "Stripe payouts"], no: ["Inventory"], cta: "Start free trial" },
  { n: "Premium", plan: "premium", p: "$79", per: "/mo", forWho: "For established shops with a bigger team", pop: false, yes: ["21-day free trial — no card", "Up to 9 barbers", "Everything in Pro", "Full POS terminal", "Inventory", "Staff & payroll", "2 locations — add more $30/mo each (up to 5)"], no: [], cta: "Start free trial" },
];

/** Marketing copy for a plan id, or undefined for a custom plan not listed here. */
export const marketingFor = (id: string): PlanMarketing | undefined =>
  PLAN_MARKETING.find(p => p.plan === id);
