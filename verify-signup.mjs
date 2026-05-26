import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const SUPABASE_URL = "https://avetaceptfpdovkuihcf.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2ZXRhY2VwdGZwZG92a3VpaGNmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTc2MDU3OSwiZXhwIjoyMDk1MzM2NTc5fQ.AzD1SGKhgzvfq0RtXQDRksnIRQPEswa9WiLzW04DkJI";
const BASE = "http://localhost:3000";
const SS = "C:/Users/gbabb/Desktop/Auth-app/clipwise/verify-screenshots";
const TS = Date.now();

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const createdUsers = [];

async function cleanup() {
  for (const id of createdUsers) {
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`Cleaned up ${createdUsers.length} test user(s).`);
}

async function dbRoleFor(userId) {
  const { data } = await admin.from("users").select("role,name,phone").eq("id", userId).single();
  return data;
}

const browser = await chromium.launch({ headless: true });

// ── helper: fill & submit signup form ─────────────────────────────────────
async function doSignup(page, { name, email, password, phone = "5065550001" }) {
  await page.fill('input[type="text"]', name);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="tel"]', phone);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

// ══════════════════════════════════════════════════════════════════════════
// TEST 1: Role picker renders on /signup
// ══════════════════════════════════════════════════════════════════════════
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
  const shopBtn = await page.locator('text="I own a barbershop"').count();
  const custBtn = await page.locator('text="I\'m looking to book"').count();
  const barberLink = await page.locator('text=Sign up as a barber').count();
  console.log(`\n[T1] Role picker: shop=${shopBtn} customer=${custBtn} barberLink=${barberLink}`);
  await page.screenshot({ path: `${SS}/signup-1-picker.png` });
  console.log(`     ${shopBtn > 0 && custBtn > 0 && barberLink > 0 ? "PASS ✅" : "FAIL ❌"}`);
  await ctx.close();
}

// ══════════════════════════════════════════════════════════════════════════
// TEST 2: Short password → inline error (no submit)
// ══════════════════════════════════════════════════════════════════════════
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
  await page.locator('text="I own a barbershop"').click();
  await page.fill('input[type="text"]', "Test User");
  await page.fill('input[type="email"]', `short_pw_${TS}@test.com`);
  await page.fill('input[type="tel"]', "5065550001");
  await page.fill('input[type="password"]', "abc123"); // 6 chars — too short
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);
  // Browser native minLength validation blocks submit before JS fires — check page stays put
  const errText = await page.locator("p.text-red-400").first().innerText().catch(() => "none (browser native validation)");
  const stillOnSignup = page.url().includes("/signup");
  console.log(`\n[T2] Short password: error="${errText}" still on signup=${stillOnSignup}`);
  await page.screenshot({ path: `${SS}/signup-2-short-pw.png` });
  console.log(`     ${stillOnSignup ? "PASS ✅ (browser blocked form)" : "FAIL ❌"}`);
  await ctx.close();
}

// ══════════════════════════════════════════════════════════════════════════
// TEST 3: Shop owner signup
// ══════════════════════════════════════════════════════════════════════════
{
  const email = `verify_owner_${TS}@test.com`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const history = [];
  page.on("framenavigated", f => { if (f === page.mainFrame()) history.push(new URL(f.url()).pathname); });

  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
  await page.locator('text="I own a barbershop"').click();
  await page.waitForTimeout(300);
  await doSignup(page, { name: "Test Owner", email, password: "TestPass123!" });
  await page.waitForTimeout(8000);

  const finalPath = new URL(page.url()).pathname;
  const emailSentVisible = await page.locator('text="Check your email"').count() > 0;
  console.log(`\n[T3] Shop owner signup:`);
  console.log(`     history: ${history.join(" → ")} | final: ${finalPath}`);
  console.log(`     "Check your email" shown: ${emailSentVisible}`);
  await page.screenshot({ path: `${SS}/signup-3-owner.png` });

  // Check role in DB
  const { data: authUsers } = await admin.auth.admin.listUsers();
  const newUser = authUsers.users.find(u => u.email === email);
  if (newUser) {
    createdUsers.push(newUser.id);
    const dbRow = await dbRoleFor(newUser.id);
    console.log(`     DB role: ${dbRow?.role} name: ${dbRow?.name}`);

    const redirectOk = finalPath === "/onboarding" || emailSentVisible;
    const roleOk = dbRow?.role === "shop_owner" || emailSentVisible; // role only set if session returned
    console.log(`     Redirect: ${redirectOk ? "PASS ✅" : `FAIL ❌ (${finalPath})`}`);
    console.log(`     Role in DB: ${dbRow?.role === "shop_owner" ? "PASS ✅" : `⚠️ still ${dbRow?.role}`}`);
  }
  await ctx.close();
}

// ══════════════════════════════════════════════════════════════════════════
// TEST 4: Customer signup
// ══════════════════════════════════════════════════════════════════════════
{
  const email = `verify_customer_${TS}@test.com`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const history = [];
  page.on("framenavigated", f => { if (f === page.mainFrame()) history.push(new URL(f.url()).pathname); });

  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
  await page.locator("text=\"I'm looking to book\"").click();
  await page.waitForTimeout(300);
  await doSignup(page, { name: "Test Customer", email, password: "TestPass123!" });
  await page.waitForTimeout(8000);

  const finalPath = new URL(page.url()).pathname;
  const emailSentVisible = await page.locator('text="Check your email"').count() > 0;
  console.log(`\n[T4] Customer signup:`);
  console.log(`     history: ${history.join(" → ")} | final: ${finalPath}`);
  await page.screenshot({ path: `${SS}/signup-4-customer.png` });

  const { data: authUsers } = await admin.auth.admin.listUsers();
  const newUser = authUsers.users.find(u => u.email === email);
  if (newUser) {
    createdUsers.push(newUser.id);
    const dbRow = await dbRoleFor(newUser.id);
    console.log(`     DB role: ${dbRow?.role}`);
    const redirectOk = finalPath === "/" || emailSentVisible;
    console.log(`     Redirect: ${redirectOk ? "PASS ✅" : `FAIL ❌ (${finalPath})`}`);
    console.log(`     Role in DB: ${dbRow?.role === "customer" ? "PASS ✅" : `⚠️ ${dbRow?.role}`}`);
  }
  await ctx.close();
}

// ══════════════════════════════════════════════════════════════════════════
// TEST 5: Barber signup (/signup/barber)
// ══════════════════════════════════════════════════════════════════════════
{
  const email = `verify_barber_${TS}@test.com`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/signup/barber`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${SS}/signup-5a-barber-form.png` });
  await page.fill('input[type="text"]', "Test Barber New");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="tel"]', "5065550001");
  await page.fill('input[type="password"]', "TestPass123!");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(8000);

  const doneBanner = await page.locator('text="Account created!"').count() > 0;
  const signInLink = await page.locator('text=Go to Sign In').count() > 0;
  console.log(`\n[T5] Barber signup: done=${doneBanner} sign-in-link=${signInLink}`);
  await page.screenshot({ path: `${SS}/signup-5b-barber-done.png` });

  const { data: authUsers } = await admin.auth.admin.listUsers();
  const newUser = authUsers.users.find(u => u.email === email);
  if (newUser) {
    createdUsers.push(newUser.id);
    const dbRow = await dbRoleFor(newUser.id);
    console.log(`     DB role: ${dbRow?.role}`);
    console.log(`     ${doneBanner && signInLink ? "PASS ✅" : "FAIL ❌"}`);
    console.log(`     Role in DB: ${dbRow?.role === "barber" ? "PASS ✅" : `⚠️ ${dbRow?.role}`}`);
  }
  await ctx.close();
}

// ══════════════════════════════════════════════════════════════════════════
// TEST 6: Duplicate email shows an error
// ══════════════════════════════════════════════════════════════════════════
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
  await page.locator('text="I own a barbershop"').click();
  await page.waitForTimeout(300);
  // Use an email we KNOW exists
  await doSignup(page, { name: "Dup User", email: "gbabbu41@gmail.com", password: "TestPass123!" });
  await page.waitForTimeout(5000);
  const errEl = await page.locator("p.text-red-400").first();
  const errText = await errEl.count() > 0 ? await errEl.innerText() : "no error";
  const emailSent = await page.locator('text="Check your email"').count() > 0;
  console.log(`\n[T6] Duplicate email: err="${errText}" emailSent=${emailSent}`);
  await page.screenshot({ path: `${SS}/signup-6-duplicate.png` });
  // Supabase may show "email sent" (enumeration protection) or an error
  console.log(`     ${errText !== "no error" || emailSent ? "PASS ✅ (handled)" : "FAIL ❌"}`);
  await ctx.close();
}

await browser.close();
await cleanup();
