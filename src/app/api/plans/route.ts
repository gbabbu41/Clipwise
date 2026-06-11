import { NextResponse } from "next/server";
import { getPlans } from "@/lib/plans-server";

// Public — returns ACTIVE plans only, ordered for display. Used by the
// onboarding pricing page, the billing page, and the client-side gating
// hydration in AuthProvider.
export async function GET() {
  const rows = await getPlans();
  const active = rows.filter((p) => p.is_active);
  return NextResponse.json({ plans: active });
}
