import { supabaseAdmin } from "@/lib/supabase-admin";
import { deleteAvatarFile } from "@/lib/storage-cleanup";

/**
 * Clean up barber logins that are left with NO shop after a shop (or an owner's
 * whole account) is deleted.
 *
 * The problem: deleting a shop cascades away its `barbers` rows, but the barber's
 * auth account (their login) lingers — so they can still sign in to a ghost
 * dashboard for a shop that no longer exists.
 *
 * The rule the owner wants: a barber's account should be removed WITH the shop —
 * UNLESS that same person still works at another shop (same login), in which case
 * we keep the account and only the deleted shop's barber row goes (already handled
 * by the FK cascade).
 *
 * IMPORTANT: pass the user_ids that were linked to the now-deleted shop(s),
 * captured BEFORE the delete — the cascade removes those `barbers` rows, so they
 * can't be looked up afterwards.
 *
 * Safety guards (a wrongful delete here is irreversible):
 *   - never touch `excludeUserId` (the owner performing the delete),
 *   - keep anyone who still has a barber row on another shop,
 *   - keep anyone who owns a shop (deleting them would cascade-delete that shop),
 *   - keep any shop_owner / super_admin account,
 *   - best-effort per user: a cleanup hiccup never fails the primary delete.
 *
 * Deletion is safe against FKs: `barbers.user_id` is ON DELETE SET NULL and
 * `public.users.id` → `auth.users` is ON DELETE CASCADE, so removing the auth
 * user unlinks any stray references and drops the profile row automatically.
 */
export async function cleanupOrphanedBarberAccounts(
  candidateUserIds: (string | null | undefined)[],
  excludeUserId: string,
): Promise<number> {
  const uids = Array.from(
    new Set(candidateUserIds.filter((v): v is string => !!v && v !== excludeUserId)),
  );
  let removed = 0;
  for (const uid of uids) {
    try {
      // Still a barber somewhere else (same login) → keep the account.
      const { data: otherBarber } = await supabaseAdmin
        .from("barbers").select("id").eq("user_id", uid).limit(1);
      if (otherBarber && otherBarber.length > 0) continue;

      // Owns a shop → they're an owner, not a pure barber. Never delete (it would
      // cascade-delete their shop).
      const { data: ownedShop } = await supabaseAdmin
        .from("shops").select("id").eq("owner_id", uid).limit(1);
      if (ownedShop && ownedShop.length > 0) continue;

      // Extra safety: never auto-delete an owner/admin account.
      const { data: profile } = await supabaseAdmin
        .from("users").select("role").eq("id", uid).maybeSingle();
      if (profile?.role === "shop_owner" || profile?.role === "super_admin") continue;

      // Pure orphaned barber → remove the login. Delete the profile row first,
      // then the auth user (mirrors /api/account/delete).
      await supabaseAdmin.from("users").delete().eq("id", uid).then(null, () => null);
      const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
      if (!error) removed++;
      // Erase their account avatar file too (public bucket → would otherwise be
      // orphaned + still fetchable). Their barber-photo is removed by the caller,
      // which captured the barber id before the cascade. Best-effort.
      await deleteAvatarFile(uid);
    } catch {
      /* best-effort: never let account cleanup fail the shop/account delete */
    }
  }
  return removed;
}
