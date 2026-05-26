import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Read .env.local manually
const env = readFileSync(".env.local", "utf8");
const get = (key) => env.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim();

const admin = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const { data, error } = await admin.from("shops").select("id, name, status, owner_id, created_at").order("created_at", { ascending: false });
if (error) console.error("Error:", error.message);
else console.log(JSON.stringify(data, null, 2));
