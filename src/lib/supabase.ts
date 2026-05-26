import { createBrowserClient } from "@supabase/ssr";

// Singleton browser client — uses cookie storage so middleware can read the session
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
