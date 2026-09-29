export type PromoDisplayInput = {
  uses_left?: number | null;
  total_uses: number | null;
  expires_at?: string | null;
  is_active: boolean;
};

export function promoDisplay(promo: PromoDisplayInput, today = new Date().toISOString().slice(0, 10)) {
  const expired = !!promo.expires_at && promo.expires_at < today;
  const remainingUses = promo.uses_left ?? null;
  const totalUses = promo.total_uses ?? 0;
  const unlimited = remainingUses === null;
  const totalAllowed = unlimited ? null : totalUses + remainingUses;

  let status: "Active" | "Inactive" | "Expired" | "Limit reached" = "Active";
  if (!promo.is_active) status = "Inactive";
  else if (expired) status = "Expired";
  else if (remainingUses !== null && remainingUses <= 0) status = "Limit reached";

  return {
    status,
    usesLabel: unlimited ? "Unlimited" : `${remainingUses} / ${totalAllowed}`,
    usagePercent: totalAllowed !== null && totalAllowed > 0
      ? Math.min(100, (totalUses / totalAllowed) * 100)
      : null,
    usageNote: unlimited ? `No usage limit · ${totalUses} redemptions` : null,
  };
}
