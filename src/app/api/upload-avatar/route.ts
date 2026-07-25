import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { detectImage, MAX_IMAGE_BYTES } from "@/lib/upload-validate";

// The signed-in user's OWN account photo → public Storage → users.avatar.
// This is the owner/account avatar shown in the portal corner across every shop
// they own — decoupled from any barber record (a barber photo is per-shop; this
// is per-person). Auth = the user themselves (a user can only set their own).
const BUCKET = "avatars";

export async function POST(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image too large (max 5 MB)." }, { status: 400 });
  }
  const img = detectImage(buffer);
  if (!img) return NextResponse.json({ error: "Only PNG, JPEG, or WebP images are allowed." }, { status: 400 });

  await supabaseAdmin.storage.createBucket(BUCKET, { public: true }).catch(() => {});
  const path = `${user.id}.${img.ext}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET).upload(path, buffer, { contentType: img.contentType, upsert: true });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: { publicUrl } } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  const url = `${publicUrl}?v=${Date.now()}`; // cache-bust on re-upload (stable path)
  const { error: updErr } = await supabaseAdmin.from("users").update({ avatar: url }).eq("id", user.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ url });
}

export async function DELETE(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await supabaseAdmin.storage.from(BUCKET)
    .remove(["jpg", "jpeg", "png", "webp"].map(e => `${user.id}.${e}`)).catch(() => {});
  await supabaseAdmin.from("users").update({ avatar: null }).eq("id", user.id);
  return NextResponse.json({ ok: true });
}
