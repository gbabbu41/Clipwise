import { chromium } from "playwright";

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();

p.on("console", m => console.log(`[${m.type()}]`, m.text()));
p.on("response", async r => {
  if (r.url().includes("/rest/v1/shops")) {
    const body = await r.text().catch(() => "");
    console.log("SHOPS RESPONSE:", r.status(), r.url().split("?")[1]?.slice(0, 80), "->", body.slice(0, 200));
  }
});

await p.goto("http://localhost:3000/admin/login", { waitUntil: "networkidle" });
await p.fill('input[type="email"]', "gbabbu41@gmail.com");
await p.fill('input[type="password"]', "Clipwise786");
await p.click('button[type="submit"]');
await p.waitForTimeout(5000);
await b.close();
