-- phase19_storage_buckets.sql
-- Make image buckets reliably PUBLIC so logos + barber photos load for anonymous
-- customers. Previously the only provisioning was a runtime createBucket({public:
-- true}) whose errors were swallowed — if the bucket ever existed as private, the
-- public URL 403'd for customers (logo "not showing"). This nails it declaratively.
-- Safe to run multiple times.

insert into storage.buckets (id, name, public)
values
  ('shop-logos',   'shop-logos',   true),
  ('barber-photos', 'barber-photos', true)
on conflict (id) do update set public = true;

-- Public buckets are readable by anyone via getPublicUrl, so no SELECT policy is
-- needed. Uploads/updates run through our service-role API routes (which bypass
-- storage RLS), so no write policy is needed either.
