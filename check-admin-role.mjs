import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = readFileSync(".env.local", "utf8");
const get = (key) => env.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim();

const admin = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

// Check admin user's role
const { data: users } = await admin.from("users").select("id, email, role").in("email", ["gbabbu41@gmail.com"]);
console.log("Admin user in DB:", JSON.stringify(users, null, 2));

// Also check what the auth user looks like
const { data: authData } = await admin.auth.admin.listUsers();
const adminAuth = authData.users.find(u => u.email === "gbabbu41@gmail.com");
console.log("Admin auth user id:", adminAuth?.id);
