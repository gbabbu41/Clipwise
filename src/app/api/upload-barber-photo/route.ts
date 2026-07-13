import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const BUCKET = "barber-photos";

/**
 * Upload a barber's profile photo → public Storage → save the URL to
 * barbers.photo (which every barber card already renders). Mirrors upload-logo.
 * Authorized for the shop OWNER of that barber OR the barber themselves.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const barberId = formData.get("barberId") as string | null;
  if (!file || !barberId) return NextResponse.json({ error: "Missing file or barberId" }, { status: 400 });

  const { data: barber } = await supabaseAdmin
    .from("barbers").select("id, shop_id, user_id").eq("id", barberId).single();
  if (!barber) return NextResponse.json({ error: "Barber not found" }, { status: 404 });

  // Authorize: the barber themselves OR the shop owner.
  let allowed = barber.user_id === user.id;
  if (!allowed) {
    const { data: shop } = await supabaseAdmin.from("shops").select("owner_id").eq("id", barber.shop_id).single();
    allowed = shop?.owner_id === user.id;
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Bucket is provisioned public by phase19; keep this as a best-effort fallback.
  await supabaseAdmin.storage.createBucket(BUCKET, { public: true }).catch(() => {});

  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
  const path = `${barberId}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: { publicUrl } } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  const url = `${publicUrl}?v=${Date.now()}`;   // bust cache on re-upload (stable path)

  await supabaseAdmin.from("barbers").update({ photo: url }).eq("id", barberId);

  return NextResponse.json({ url });
}

// Remove a barber's photo — clears barbers.photo and deletes the stored file.
// Authorized for the barber themselves OR the shop owner (same as upload).
export async function DELETE(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const barberId = new URL(req.url).searchParams.get("barberId");
  if (!barberId) return NextResponse.json({ error: "Missing barberId" }, { status: 400 });

  const { data: barber } = await supabaseAdmin
    .from("barbers").select("id, shop_id, user_id").eq("id", barberId).single();
  if (!barber) return NextResponse.json({ error: "Barber not found" }, { status: 404 });

  let allowed = barber.user_id === user.id;
  if (!allowed) {
    const { data: shop } = await supabaseAdmin.from("shops").select("owner_id").eq("id", barber.shop_id).single();
    allowed = shop?.owner_id === user.id;
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Photo path is `${barberId}.<ext>` at the bucket root; remove() ignores
  // paths that don't exist, so clearing all candidate extensions is safe.
  await supabaseAdmin.storage.from(BUCKET)
    .remove(["jpg", "jpeg", "png", "webp"].map((e) => `${barberId}.${e}`)).catch(() => {});
  await supabaseAdmin.from("barbers").update({ photo: null }).eq("id", barberId);

  return NextResponse.json({ ok: true });
}
