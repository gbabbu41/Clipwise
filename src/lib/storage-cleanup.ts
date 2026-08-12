import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Delete a user's uploaded image files from storage on account/shop/barber
 * deletion. The DB rows cascade away, but the FILES in the PUBLIC buckets
 * (avatars, barber-photos, shop-logos) would otherwise be orphaned and stay
 * publicly fetchable after the person exercised their right to erasure — this
 * closes that gap.
 *
 * Uploads only ever store these extensions (see lib/upload-validate), and we
 * can't know which one a given id used, so we remove every variant. storage
 * .remove() silently ignores paths that don't exist, so this is safe + idempotent.
 * All best-effort: a storage hiccup must never fail a deletion request.
 */
const IMG_EXTS = ["png", "jpg", "jpeg", "webp"];

async function removeAll(bucket: string, base: string): Promise<void> {
  try {
    await supabaseAdmin.storage.from(bucket).remove(IMG_EXTS.map(e => `${base}.${e}`));
  } catch { /* best-effort */ }
}

/** avatars/<userId>.<ext> — account holder / owner face photo. */
export async function deleteAvatarFile(userId: string): Promise<void> {
  if (userId) await removeAll("avatars", userId);
}

/** barber-photos/<barberId>.<ext> — barber face photo. */
export async function deleteBarberPhotoFile(barberId: string): Promise<void> {
  if (barberId) await removeAll("barber-photos", barberId);
}

/** shop-logos/<shopId>/logo.<ext> — shop logo. */
export async function deleteShopLogoFile(shopId: string): Promise<void> {
  if (shopId) await removeAll("shop-logos", `${shopId}/logo`);
}
