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
  // The egress proxy blocks third-party hosts (analytics, fonts, Stripe.js beacons)
  // and resets some Next.js RSC prefetch requests. Those surface as console errors
  // that are artifacts of THIS test environment, not app bugs — filter them out so
  // they don't mask genuine errors. A real failed prefetch just falls back to a
  // full navigation, which the flow already exercises.
  const proxyNoise = /ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_RESET|ERR_PROXY_CONNECTION_FAILED|ERR_BLOCKED_BY|Failed to load resource|Failed to fetch RSC payload|net::ERR_FAILED|TypeError: Failed to fetch/i;
  const keep = (s) => !proxyNoise.test(s);
  page.on("pageerror", (e) => { const s = "pageerror: " + e.message; if (keep(s)) errs.push(s); });
  page.on("console", (m) => { if (m.type() === "error") { const s = "console: " + m.text(); if (keep(s)) errs.push(s); } });
  return () => errs;
}

// Log in through the real /login form and wait until we leave /login.
async function login(page, who, expectPathIncludes) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  // The page has TWO submit buttons: a "Continue with Google" OAuth button that
  // sits ABOVE the email/password <form>, and the real "Sign In" button inside
  // it. A bare button[type=submit] would click Google — scope to the form.
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });
  if (expectPathIncludes) need(page.url().includes(expectPathIncludes), `expected to land on ${expectPathIncludes}, got ${page.url()}`);
}

// A visible "Continue" click for the booking wizard (there is exactly one per step).
const clickContinue = async (page) => { await page.getByRole("button", { name: /^Continue$/ }).click(); };

// Re-open the wizard, land on the SAME day, and report whether `slot` is gone
// (i.e. the earlier booking now blocks it). Returns true when double-booking
// is correctly prevented.
async function slotIsBlocked(page, slug, dayNum, slot) {
  await page.goto(`${BASE}/book/${slug}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.locator('button:has-text("+")').first().click();
  await page.waitForTimeout(600);
  await clickContinue(page);
  await page.waitForTimeout(1800);
  // Ensure we are on the same day the earlier appointment was booked for.
  if (dayNum != null) {
    const pill = page.locator("button").filter({ hasText: new RegExp(`^[A-Za-z]${dayNum}$`) }).first();
    if (await pill.count()) { await pill.click(); await page.waitForTimeout(1500); }
  }
  // Wait for slots to (re)load, then check the taken slot is no longer offered.
  await page.locator("button").filter({ hasText: /\d{1,2}:\d{2}\s*(AM|PM)/i }).first().waitFor({ timeout: 12000 }).catch(() => {});
  const slotRe = new RegExp(slot.replace(/\s+/g, "\\s*").replace(/([().])/g, "\\$1"), "i");
  const stillOffered = await page.locator("button").filter({ hasText: slotRe }).count();
  return stillOffered === 0;
}

async function run() {
  log(`\nClipWise E2E → ${BASE}\n${"=".repeat(40)}`);
  // Use the environment's pre-installed Chromium (the npm playwright build may
  // not match), and route through the egress proxy when one is set. TLS trust is
  // expected to be wired by the environment — we never disable verification.
  // Force TLS 1.2: Chromium's default TLS 1.3 ClientHello (post-quantum key
  // share) is reset by the egress proxy on CONNECT tunnels, surfacing as
  // ERR_CONNECTION_RESET. TLS 1.2 negotiates cleanly and the proxy CA is
  // already trusted — no certificate verification is disabled.
  const launchOpts = { headless: HEADLESS, args: ["--ssl-version-max=tls1.2", "--no-sandbox"] };
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
    await check("barber portal reachable (barber-dashboard renders)", async () => {
      // A dedicated barber lands on /barber-dashboard directly; an owner who is
      // ALSO a barber lands on /dashboard, so don't assert the post-login path —
      // log in, then navigate to the barber portal and confirm it renders.
      await login(page, BARBER);
      await page.goto(`${BASE}/barber-dashboard`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      need(!page.url().includes("/login"), "bounced to login — account lacks barber access");
      need(await page.getByText(/Overview|Calendar|Schedule|Today/i).count() > 0, "barber dashboard shell did not render");
      await shot(page, "30-barber-home");
    });
    await check("barber calendar renders", async () => {
      await page.goto(`${BASE}/barber-dashboard/calendar`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(2000);
      need(!page.url().includes("/login"), "barber calendar bounced to login");
      await shot(page, "31-barber-calendar");
    });
    await check("no JS errors across barber pages", async () => {
      need(errs().length === 0, "errors: " + errs().slice(0, 3).join(" | "));
    });
    await page.close();
  }

  // ── 4. Public booking page + full appointment lifecycle ─────────────────────
  // The lifecycle exercises the OWNER-facing transitions on a real PENDING
  // appointment (Approve → Check out/Complete), that it renders on the calendar,
  // and that the live availability API refuses to double-book its slot.
  //
  // A customer can only reach the `pending` state through the public wizard, but
  // on shops that take payment ONLINE ONLY (no pay-in-person) that path goes
  // through Stripe Checkout, which can't be driven headless. So the pending row
  // is supplied one of two ways:
  //   • Self-seed : E2E_SUPABASE_URL + E2E_SUPABASE_SERVICE_KEY + a seed target
  //                 (E2E_LC_BARBER_ID / E2E_LC_SERVICE_ID / E2E_LC_DATE / E2E_LC_SLOT
  //                 / E2E_LC_DAYNUM). The suite inserts the pending appt and deletes
  //                 it in a finally block — fully self-contained.
  //   • External  : seed a pending appt yourself, then pass E2E_LC_CLIENT (its
  //                 client_name), E2E_LC_SLOT and E2E_LC_DAYNUM. You own cleanup.
  log("\nPublic booking + appointment lifecycle:");

  if (SHOP_SLUG) {
    const cust = await ctx.newPage();
    await check("public booking page loads", async () => {
      const r = await cust.goto(`${BASE}/book/${SHOP_SLUG}`, { waitUntil: "domcontentloaded" });
      need(r && r.status() < 400, `status ${r && r.status()}`);
      await cust.waitForTimeout(1500);
      need(await cust.getByText(/Choose services|Choose Time First/i).count() > 0, "booking wizard did not render");
      await shot(cust, "40-booking");
    });
    await cust.close();
  }

  const LC_SLOT = process.env.E2E_LC_SLOT;
  const LC_DAYNUM = process.env.E2E_LC_DAYNUM ? Number(process.env.E2E_LC_DAYNUM) : null;
  const canSeed = !!(process.env.E2E_SUPABASE_URL && process.env.E2E_SUPABASE_SERVICE_KEY &&
    process.env.E2E_LC_BARBER_ID && process.env.E2E_LC_SERVICE_ID && process.env.E2E_LC_DATE && LC_SLOT);
  if (!OWNER.email || !SHOP_SLUG || !LC_SLOT || (!canSeed && !process.env.E2E_LC_CLIENT)) {
    skip++; log("  – SKIP lifecycle (needs owner creds + slug + a pending appt via self-seed or E2E_LC_CLIENT; see header comment)");
  } else {
    let CLIENT = process.env.E2E_LC_CLIENT;
    let cleanup = null;
    if (canSeed) {
      const { createClient } = await import("@supabase/supabase-js");
      const sb = createClient(process.env.E2E_SUPABASE_URL, process.env.E2E_SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
      const marker = process.env.E2E_MARKER || String(Date.now()).slice(-6);
      CLIENT = `E2E Test ${marker}`;
      const { data: shopRow, error: sErr } = await sb.from("shops").select("id").eq("slug", SHOP_SLUG).single();
      if (sErr) throw new Error("seed: shop lookup failed: " + sErr.message);
      const { data: ins, error: iErr } = await sb.from("appointments").insert({
        shop_id: shopRow.id, barber_id: process.env.E2E_LC_BARBER_ID, service_id: process.env.E2E_LC_SERVICE_ID,
        client_name: CLIENT, client_email: `e2e-${marker}@clipwise.test`, client_phone: "4165550123",
        date: process.env.E2E_LC_DATE, time_slot: LC_SLOT, status: "pending",
        total_amount: 30, duration_minutes: 30, payment_status: "unpaid",
      }).select("id").single();
      if (iErr) throw new Error("seed: insert failed: " + iErr.message);
      cleanup = async () => { await sb.from("appointments").delete().eq("id", ins.id); };
      log(`  (self-seeded pending appt ${ins.id} as "${CLIENT}")`);
    } else {
      log(`  (driving externally-seeded pending appt for "${CLIENT}")`);
    }
    const rowFor = (page) => page.locator("tr").filter({ hasText: CLIENT });

    const page = await ctx.newPage();
    const oErrs = trackErrors(page);
    try {
      await check("owner sees the pending appointment", async () => {
        await login(page, OWNER, "/dashboard");
        await page.goto(`${BASE}/dashboard/appointments`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1500);
        // Two independent <select> filters (plus a barber one). Target each by an
        // option it uniquely owns. Date → "upcoming" (today onward). Status →
        // "all" (defaults to "active" = pending+booked, which would hide the row
        // once it is Completed).
        await page.locator("select").filter({ has: page.locator('option[value="upcoming"]') }).selectOption("upcoming").catch(() => {});
        await page.locator("select").filter({ has: page.locator('option[value="active"]') }).selectOption("all").catch(() => {});
        await page.waitForTimeout(800);
        await page.getByPlaceholder(/Search client/i).fill(CLIENT).catch(() => {});
        await page.waitForTimeout(1200);
        need(await rowFor(page).count() > 0, "pending appointment row not found in owner list");
        await shot(page, "42-owner-sees-pending");
      });
      await check("owner Approves (pending → Booked)", async () => {
        await rowFor(page).getByRole("button", { name: /Approve/ }).first().click();
        await page.waitForTimeout(2500);
        need(await rowFor(page).getByText(/Booked/i).count() > 0, "did not advance to Booked");
      });
      await check("owner Checks out (Booked → Completed)", async () => {
        await rowFor(page).getByRole("button", { name: /Check out/ }).first().click();
        await page.waitForTimeout(1500);
        // Unpaid booking → payment modal. Complete without taking payment.
        const skipBtn = page.getByRole("button", { name: /Complete unpaid|Skip/i });
        if (await skipBtn.count()) { await skipBtn.first().click(); }
        // The list reloads asynchronously after the status write — poll the row's
        // status pill. (Row stays visible because the filter is "All Statuses".)
        let done = false;
        for (let i = 0; i < 12 && !done; i++) {
          await page.waitForTimeout(1000);
          done = await rowFor(page).getByText(/Completed/i).count() > 0;
        }
        need(done, "did not reach Completed");
        await shot(page, "43-owner-completed");
      });

      await check("appointment appears on the calendar", async () => {
        await page.goto(`${BASE}/dashboard/calendar`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3000);
        let found = await page.getByText(CLIENT).count(); // day view (default) may already show it
        if (!found) { // step up to Month view (chips for the whole month)
          await page.locator('[aria-label^="Back to"]').first().click().catch(() => {});
          await page.waitForTimeout(2000);
          found = await page.getByText(CLIENT).count();
        }
        need(found > 0, "appointment not visible on the calendar");
        await shot(page, "44-calendar");
      });
      await check("no JS errors across owner lifecycle pages", async () => {
        need(oErrs().length === 0, "errors: " + oErrs().slice(0, 3).join(" | "));
      });

      await check("double-booking the same slot is blocked", async () => {
        const cust2 = await ctx.newPage();
        try {
          const blocked = await slotIsBlocked(cust2, SHOP_SLUG, LC_DAYNUM, LC_SLOT);
          await shot(cust2, "45-double-book-blocked");
          need(blocked, `slot "${LC_SLOT}" still offered on day ${LC_DAYNUM} — double-booking NOT prevented`);
        } finally { await cust2.close(); }
      });
    } finally {
      await page.close();
      if (cleanup) { try { await cleanup(); log("  (cleaned up self-seeded appt)"); } catch (e) { log("  ! cleanup failed: " + e.message); } }
    }
  }

  await ctx.close();
  await browser.close();
  log(`\n${"=".repeat(40)}\n${pass} passed, ${fail} failed, ${skip} skipped`);
  log(`Screenshots: ${SHOT_DIR}/\n`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { log("FATAL: " + (e.stack || e)); process.exit(1); });
