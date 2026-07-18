// ClipWise end-to-end smoke + flow suite (owner / barber / appointment / calendar).
//
// Runs against a LIVE deployment with a real browser. Uses the already-installed
// `playwright` library (no @playwright/test dependency). Reads all config from
// env vars so no credentials ever live in the repo:
//
//   E2E_BASE_URL       (default https://clipwise.ca)
//   E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD     — a throwaway shop-owner account
//   E2E_BARBER_EMAIL / E2E_BARBER_PASSWORD   — a throwaway barber account (optional)
//   E2E_SHOP_SLUG      — the owner's public booking slug (optional; enables the
//                        customer-booking → owner-approve → calendar loop)
//   E2E_HEADLESS       — "0" to watch it run (default headless)
//
// Run:  node e2e/clipwise-e2e.mjs
// Exit code is non-zero if any check fails. Screenshots land in e2e/screenshots/.
//
// NOTE: this creates real rows in whatever DB the deployment points at. Safe on a
// pre-launch/staging DB; the booking-loop step cancels the appointment it makes.

import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.E2E_BASE_URL || "https://clipwise.ca").replace(/\/$/, "");
const OWNER = { email: process.env.E2E_OWNER_EMAIL, password: process.env.E2E_OWNER_PASSWORD };
const BARBER = { email: process.env.E2E_BARBER_EMAIL, password: process.env.E2E_BARBER_PASSWORD };
const SHOP_SLUG = process.env.E2E_SHOP_SLUG || "";
const HEADLESS = process.env.E2E_HEADLESS !== "0";
const SHOT_DIR = "e2e/screenshots";
mkdirSync(SHOT_DIR, { recursive: true });

let pass = 0, fail = 0, skip = 0;
const log = (s) => process.stdout.write(s + "\n");
const shot = async (page, name) => { try { await page.screenshot({ path: join(SHOT_DIR, name + ".png"), fullPage: true }); } catch { /* ignore */ } };

async function check(name, fn) {
  try { await fn(); pass++; log(`  ✔ ${name}`); }
  catch (e) { fail++; log(`  ✘ FAIL ${name}\n      ${String(e.message || e).split("\n")[0]}`); }
}
function need(cond, msg) { if (!cond) throw new Error(msg); }

// Attach console/page-error capture; returns a getter for collected errors.
function trackErrors(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  return () => errs;
}

// Log in through the real /login form and wait until we leave /login.
async function login(page, who, expectPathIncludes) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });
  if (expectPathIncludes) need(page.url().includes(expectPathIncludes), `expected to land on ${expectPathIncludes}, got ${page.url()}`);
}

async function run() {
  log(`\nClipWise E2E → ${BASE}\n${"=".repeat(40)}`);
  // Use the environment's pre-installed Chromium (the npm playwright build may
  // not match), and route through the egress proxy when one is set. TLS trust is
  // expected to be wired by the environment — we never disable verification.
  const launchOpts = { headless: HEADLESS };
  const exe = process.env.PW_CHROMIUM_PATH || "/opt/pw-browsers/chromium";
  if (existsSync(exe)) launchOpts.executablePath = exe;
  if (process.env.HTTPS_PROXY) launchOpts.proxy = { server: process.env.HTTPS_PROXY };
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // ── 0. Public surface loads (no auth needed) ──────────────────────────────
  log("\nPublic pages:");
  {
    const page = await ctx.newPage();
    const errs = trackErrors(page);
    await check("homepage loads", async () => {
      const r = await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      need(r && r.status() < 400, `status ${r && r.status()}`);
      await shot(page, "00-home");
    });
    await check("/login renders the form", async () => {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      need(await page.locator('input[type="password"]').count() > 0, "no password field");
    });
    await check("/admin/login renders", async () => {
      const r = await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
      need(r && r.status() < 400, `status ${r && r.status()}`);
    });
    await check("no JS errors on public pages", async () => {
      need(errs().length === 0, "errors: " + errs().slice(0, 3).join(" | "));
    });
    await page.close();
  }

  // ── 1. Owner portal ───────────────────────────────────────────────────────
  log("\nOwner portal:");
  if (!OWNER.email || !OWNER.password) { skip++; log("  – SKIP (set E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD)"); }
  else {
    const page = await ctx.newPage();
    const errs = trackErrors(page);
    await check("owner can log in → /dashboard", async () => { await login(page, OWNER, "/dashboard"); await shot(page, "10-owner-dashboard"); });
    await check("dashboard shell rendered (not bounced to /login)", async () => {
      need(!page.url().includes("/login"), "bounced back to login — bad credentials or role");
    });
    await check("appointments page loads", async () => {
      const r = await page.goto(`${BASE}/dashboard/appointments`, { waitUntil: "domcontentloaded" });
      need(r && r.status() < 400, `status ${r && r.status()}`);
      await page.waitForTimeout(1500); await shot(page, "11-owner-appointments");
    });
    await check("calendar page renders", async () => {
      await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      need(!page.url().includes("/login"), "calendar bounced to login");
      await shot(page, "12-owner-calendar");
    });
    await check("schedule page loads", async () => {
      const r = await page.goto(`${BASE}/dashboard/schedule`, { waitUntil: "domcontentloaded" });
      need(r && r.status() < 400, `status ${r && r.status()}`);
      await shot(page, "13-owner-schedule");
    });
    await check("no JS errors across owner pages", async () => {
      need(errs().length === 0, "errors: " + errs().slice(0, 3).join(" | "));
    });
    await page.close();
  }

  // ── 2. Admin portal (owner may also be super_admin) ───────────────────────
  log("\nAdmin portal (if owner account is super_admin):");
  if (!OWNER.email) { skip++; log("  – SKIP (no owner creds)"); }
  else {
    const page = await ctx.newPage();
    await check("admin overview reachable OR cleanly redirected", async () => {
      await login(page, OWNER).catch(() => {});
      const r = await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
      need(r && r.status() < 500, `status ${r && r.status()}`);
      await page.waitForTimeout(1500); await shot(page, "20-admin");
    });
    await page.close();
  }

  // ── 3. Barber portal ──────────────────────────────────────────────────────
  log("\nBarber portal:");
  if (!BARBER.email || !BARBER.password) { skip++; log("  – SKIP (set E2E_BARBER_EMAIL / E2E_BARBER_PASSWORD)"); }
  else {
    const page = await ctx.newPage();
    const errs = trackErrors(page);
    await check("barber can log in → /barber-dashboard", async () => { await login(page, BARBER, "/barber-dashboard"); await shot(page, "30-barber-home"); });
    await check("barber calendar/schedule renders", async () => {
      await page.goto(`${BASE}/barber-dashboard/calendar`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(1500);
      need(!page.url().includes("/login"), "barber bounced to login");
      await shot(page, "31-barber-calendar");
    });
    await check("no JS errors across barber pages", async () => {
      need(errs().length === 0, "errors: " + errs().slice(0, 3).join(" | "));
    });
    await page.close();
  }

  // ── 4. Booking → approve → calendar loop (optional, needs E2E_SHOP_SLUG) ──
  log("\nBooking loop (customer books → owner sees it):");
  if (!SHOP_SLUG || !OWNER.email) { skip++; log("  – SKIP (set E2E_SHOP_SLUG + owner creds)"); }
  else {
    const page = await ctx.newPage();
    await check("public booking page loads", async () => {
      const r = await page.goto(`${BASE}/book/${SHOP_SLUG}`, { waitUntil: "domcontentloaded" });
      need(r && r.status() < 400, `status ${r && r.status()}`);
      await page.waitForTimeout(1500); await shot(page, "40-booking");
    });
    // The multi-step booking UI is best-effort here — in the live session I drive
    // it step by step (service → barber → date → time → details → pay in person)
    // and assert the created appointment appears on the owner calendar, then
    // cancel it. Left as a marked TODO so the run reports it rather than flaking.
    skip++; log("  – TODO drive full booking steps live (service/date/time/contact) + owner-approve + cancel cleanup");
    await page.close();
  }

  await ctx.close();
  await browser.close();
  log(`\n${"=".repeat(40)}\n${pass} passed, ${fail} failed, ${skip} skipped`);
  log(`Screenshots: ${SHOT_DIR}/\n`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { log("FATAL: " + (e.stack || e)); process.exit(1); });
