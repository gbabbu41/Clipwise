-- ============================================================
-- ClipWise Seed — Super Admin Account
-- ============================================================
-- Step 1: Create the admin user in Supabase Authentication
--   Dashboard → Authentication → Users → Add user
--   Email: admin@clipwise.com
--   Password: ClipWise2026!
--   Click "Create User" then copy the UUID shown
--
-- Step 2: Replace 'PASTE-UUID-HERE' below with the actual UUID
--   and run this SQL in the SQL Editor
-- ============================================================

-- Set the super_admin role for the admin user
update public.users
set role = 'super_admin', name = 'ClipWise CEO'
where email = 'admin@clipwise.com';

-- Verify it worked:
-- select id, email, role from public.users where email = 'admin@clipwise.com';
