import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Public receipt view, keyed by the unguessable transaction UUID (the "Share"
// link on the receipt page). transactions RLS is owner/stakeholder-only, so the
// anon browser can't read it — which meant a shared receipt link dead-ended
// with "Receipt Not Found" for the customer it was sent to. This service-role
// route returns ONLY the fields the receipt actually renders — never
// payment_intent / stripe ids, stripe_fee, commission, or the rest of the
// shop's booking_settings config.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("transactions")
    .select("id, client_name, service_name, amount, tip, tax, payment_method, created_at, shops(name, address, city, province, phone, booking_settings), barbers(name)")
    .eq("id", id)
    .maybeSingle();

  // Split a real 0-row miss (404) from a transient DB/network error (retryable).
  if (error) return NextResponse.json({ error: "Load failed" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const shop = Array.isArray(data.shops) ? data.shops[0] : data.shops;
  const barber = Array.isArray(data.barbers) ? data.barbers[0] : data.barbers;
  // Pull ONLY the tax fields off booking_settings — never expose the whole
  // config blob (no-show fees, AI settings, etc.) to a public receipt viewer.
  const bs = (shop?.booking_settings ?? {}) as { tax_number?: string; pst_number?: string; tax_label?: string };

  return NextResponse.json({
    receipt: {
      id: data.id,
      client_name: data.client_name,
      service_name: data.service_name,
      amount: data.amount,
      tip: data.tip,
      tax: data.tax,
      payment_method: data.payment_method,
      created_at: data.created_at,
      shop: shop ? {
        name: shop.name, address: shop.address, city: shop.city, province: shop.province, phone: shop.phone,
        tax_number: bs.tax_number ?? null, pst_number: bs.pst_number ?? null, tax_label: bs.tax_label ?? null,
      } : null,
      barber: barber ? { name: barber.name } : null,
    },
  });
}
