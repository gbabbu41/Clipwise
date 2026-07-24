-- ============================================================================
-- Phase 33: security hardening (from Supabase's Security Advisor).
--
-- SAFE TO RUN, idempotent, and it SKIPS anything that doesn't exist:
--   1) Pin search_path = public on our functions — closes the "mutable
--      search_path" warning (a hardening best-practice; non-breaking since these
--      functions already operate in the public schema).
--   2) REVOKE direct EXECUTE from anon/authenticated on the TRIGGER-only
--      functions. They fire as triggers regardless of these grants, so this has
--      ZERO app impact — it just stops them being pokeable directly via RPC.
--
-- Deliberately NOT changed here (need their own tested pass):
--   • is_super_admin / owns_shop / user_shop_id — RLS policies call these, so
--     they must stay EXECUTE-able. (We only pin their search_path.)
--   • waitlist_insert_public RLS (WITH CHECK true) — low-severity spam risk;
--     tighten in a tested change. (The app inserts via the service role anyway.)
--   • Auth "leaked password protection" — a Supabase dashboard toggle, not SQL.
-- ============================================================================

do $$
declare fn text;
begin
  -- 1) Pin search_path on every function we own (RLS helpers included — safe).
  foreach fn in array array[
    'public.is_super_admin()',
    'public.owns_shop(uuid)',
    'public.user_shop_id()',
    'public.clipwise_slot_minutes(text)',
    'public.prevent_role_escalation()',
    'public.prevent_shop_field_escalation()',
    'public.restrict_barber_self_update()',
    'public.set_plans_updated_at()',
    'public.clipwise_prevent_overlap()',
    'public.clamp_shop_self_insert()',
    'public.guard_multi_location()',
    'public.handle_new_user()'
  ] loop
    begin
      execute format('alter function %s set search_path = public', fn);
    exception when undefined_function then null; -- skip if this DB doesn't have it
    end;
  end loop;

  -- 2) Revoke direct EXECUTE on TRIGGER-only functions (no app impact — they run
  --    as triggers). Must revoke from PUBLIC, not anon/authenticated: Postgres
  --    grants EXECUTE to the PUBLIC pseudo-role by default, and both roles
  --    inherit it through PUBLIC — so revoking from anon/authenticated alone is a
  --    no-op. NOT the RLS-helper functions above (policies call those).
  foreach fn in array array[
    'public.prevent_role_escalation()',
    'public.prevent_shop_field_escalation()',
    'public.restrict_barber_self_update()',
    'public.set_plans_updated_at()',
    'public.clipwise_prevent_overlap()',
    'public.clamp_shop_self_insert()',
    'public.guard_multi_location()',
    'public.handle_new_user()'
  ] loop
    begin
      execute format('revoke execute on function %s from public', fn);
    exception when undefined_function then null;
    end;
  end loop;
end $$;
