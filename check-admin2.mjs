import { chromium } from "playwright";

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();

// Intercept the shops request to see the Authorization header
p.on("request", req => {
  if (req.url().includes("/rest/v1/shops")) {
    const auth = req.headers()["authorization"] ?? "NONE";
    console.log("SHOPS REQUEST auth header:", auth.slice(0, 60));
  }
});

await p.goto("http://localhost:3000/admin/login", { waitUntil: "networkidle" });
await p.fill('input[type="email"]', "gbabbu41@gmail.com");
await p.fill('input[type="password"]', "Clipwise786");
await p.click('button[type="submit"]');
await p.waitForTimeout(5000);

// Also check session directly from the page
const session = await p.evaluate(async () => {
  // Can't access supabase directly but check cookies
  return document.cookie.split(";").map(c => c.trim()).filter(c => c.startsWith("sb-"));
});
console.log("Supabase cookies:", session);

await b.close();
