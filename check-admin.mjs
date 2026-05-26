import { chromium } from "playwright";

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();

p.on("console", m => { if (m.type() === "error") console.log("CONSOLE ERROR:", m.text()); });
p.on("response", async r => {
  if (r.url().includes("/rest/v1/shops")) {
    const body = await r.text().catch(() => "");
    console.log("SHOPS RESPONSE:", r.status(), body.slice(0, 500));
  }
});

await p.goto("http://localhost:3000/admin/login", { waitUntil: "networkidle" });
await p.fill('input[type="email"]', "gbabbu41@gmail.com");
await p.fill('input[type="password"]', "Clipwise786");
await p.click('button[type="submit"]');
await p.waitForTimeout(4000);
await p.screenshot({ path: "verify-screenshots/admin-overview.png" });

await p.locator('button:has-text("Pending")').first().click();
await p.waitForTimeout(1000);
await p.screenshot({ path: "verify-screenshots/admin-pending.png" });

console.log("Final URL:", p.url());
await b.close();
