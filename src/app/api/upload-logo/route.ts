import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const BUCKET = "shop-logos";

export async function POST(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const shopId = formData.get("shopId") as string | null;

  if (!file || !shopId) return NextResponse.json({ error: "Missing file or shopId" }, { status: 400 });

  const { data: shop } = await supabaseAdmin.from("shops").select("id, owner_id").eq("id", shopId).single();
  if (!shop || shop.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Ensure bucket exists (no-op if already created)
  await supabaseAdmin.storage.createBucket(BUCKET, { public: true }).catch(() => {});

  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
  const path = `${shopId}/logo.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: { publicUrl } } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  // The path is stable (logo.<ext>, upsert) so add a version param to bust the
  // browser/CDN cache when the logo is replaced.
  const url = `${publicUrl}?v=${Date.now()}`;

  await supabaseAdmin.from("shops").update({ logo: url }).eq("id", shopId);

  return NextResponse.json({ url });
}
