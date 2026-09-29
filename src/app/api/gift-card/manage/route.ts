import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { authorizeShop } from "@/lib/api-auth";
import { logGiftFailure } from "@/lib/gift-redeem";

// Owner-only gift-card corrections. A card balance is stored money, so it only
// ever changes in ONE locked database step that also writes the history row
// (phase70: gift_adjust_manual / gift_set_active). Spending a card on a sale is
// NOT done here — that's the POS ("Use at checkout"), which records the sale too.

const ADJUST_MESSAGES: Record<string, { status: number; error: string }> = {
  not_found: { status: 404, error: "Gift card not found." },
  no_change: { status: 400, error: "Nothing to change." },
  void: { status: 409, error: "This card is voided — reactivate it first." },
  insufficient: { status: 409, error: "That's more than the card's balance." },
  above_value: { status: 409, error: "A card can't go above its original value — issue a new card instead." },
};
const ACTIVE_MESSAGES: Record<string, { status: number; error: string }> = {
  not_found: { status: 404, error: "Gift card not found." },
  no_change: { status: 409, error: "The card is already in that state." },
  empty: { status: 409, error: "This card has no balance left to reactivate." },
};

const rowOf = <T,>(data: unknown): T | null => (Array.isArray(data) ? data[0] : data) as T | null;

/** A card's history (newest first) — sales, give-backs, corrections, voids. */
export async function GET(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get("shop_id");
  const cardId = request.nextUrl.searchParams.get("gift_card_id");
  const auth = await authorizeShop(request, shopId, { ownerOnly: true });
  if ("error" in auth) return auth.error;
  if (!cardId) return NextResponse.json({ error: "Missing gift card" }, { status: 400 });
  const { data, error } = await supabaseAdmin
    .from("gift_card_ledger").select("id, amount, action, note, appointment_id, created_at")
    .eq("shop_id", auth.shop.id).eq("gift_card_id", cardId)
    .order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "Couldn't load the card's history." }, { status: 500 });
  return NextResponse.json({ history: data ?? [] });
}

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => ({})) as {
    shop_id?: string; gift_card_id?: string; action?: string; amount?: number; reason?: string;
  };
  const auth = await authorizeShop(request, b.shop_id, { ownerOnly: true });
  if ("error" in auth) return auth.error;
  if (!b.gift_card_id || typeof b.gift_card_id !== "string") return NextResponse.json({ error: "Missing gift card" }, { status: 400 });
  const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 200) : "";
  const ids = { shopId: auth.shop.id, giftCardId: b.gift_card_id };

  if (b.action === "adjust") {
    const amount = Math.round(Number(b.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1000) return NextResponse.json({ error: "Enter an amount to add or remove." }, { status: 400 });
    if (!reason) return NextResponse.json({ error: "Add a reason for the change." }, { status: 400 });
    const { data, error } = await supabaseAdmin.rpc("gift_adjust_manual", {
      p_shop_id: auth.shop.id, p_gift_card_id: b.gift_card_id, p_delta: amount, p_note: reason, p_user_id: auth.user.id,
    });
    if (error) {
      await logGiftFailure("gift-card/manage adjust", ids, error);
      return NextResponse.json({ error: "Couldn't save the change — nothing was changed. Please try again." }, { status: 500 });
    }
    const row = rowOf<{ applied: number | string; balance: number | string | null; status: string }>(data);
    if (!row || row.status !== "ok") {
      const m = ADJUST_MESSAGES[row?.status ?? ""] ?? { status: 500, error: "Couldn't save the change." };
      return NextResponse.json({ error: m.error }, { status: m.status });
    }
    return NextResponse.json({ ok: true, applied: Number(row.applied), balance: Number(row.balance) });
  }

  if (b.action === "void" || b.action === "reactivate") {
    const { data, error } = await supabaseAdmin.rpc("gift_set_active", {
      p_shop_id: auth.shop.id, p_gift_card_id: b.gift_card_id, p_active: b.action === "reactivate", p_note: reason || null, p_user_id: auth.user.id,
    });
    if (error) {
      await logGiftFailure(`gift-card/manage ${b.action}`, ids, error);
      return NextResponse.json({ error: "Couldn't save the change — nothing was changed. Please try again." }, { status: 500 });
    }
    const status = rowOf<string>(data);
    if (status !== "ok") {
      const m = ACTIVE_MESSAGES[String(status)] ?? { status: 500, error: "Couldn't save the change." };
      return NextResponse.json({ error: m.error }, { status: m.status });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
