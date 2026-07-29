// Build-time tripwire: if this file is ever pulled into a browser bundle (e.g.
// a "use client" component importing it directly or transitively), the build
// FAILS here instead of silently shipping a blank page to users — which is
// exactly the class of bug that took down the dashboard. Server code is fine.
import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only — never import in "use client" components
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
