---
description: Real build, then commit + push to main (explicit ship — this IS the approval)
---

Ship the current changes. Invoking `/ship` is explicit approval to build, commit, and
push (it overrides the analyze-first default). Optional commit message: $ARGUMENTS

Steps:
1. **Real build gate** (never `tsc` — the container's tsc has broken module resolution):
   `SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder SUPABASE_SERVICE_ROLE_KEY=placeholder RESEND_API_KEY=re_placeholder STRIPE_SECRET_KEY=sk_test_placeholder STRIPE_WEBHOOK_SECRET=whsec_placeholder TWILIO_ACCOUNT_SID=ACplaceholder TWILIO_AUTH_TOKEN=placeholder TWILIO_PHONE_NUMBER=+15555555555 CRON_SECRET=placeholder NEXT_PUBLIC_APP_URL=https://clipwise.ca npx next build`
   Require **"✓ Compiled successfully"** and **"Generating static pages (N/N)"**. The
   placeholder-secret runtime errors during page-data collection are expected and NOT failures.
2. **If the build fails → STOP.** Report the error; do not push.
3. If green: `git checkout package-lock.json` (if npm ran), stage all, commit with the
   standard trailer (`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` +
   `Claude-Session: ...`), and `git push -u origin HEAD:main` (Vercel auto-deploys to
   clipwise.ca). Retry push up to 4× with backoff on network errors only.
4. Summarize what shipped in plain language, and call out **any pending SQL migration**
   the change needs (Supabase runs are manual).
