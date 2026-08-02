# ClipWise Voice Server (AI phone booking)

This is the **AI brain** for phone bookings. It runs separately from the main
ClipWise app because a phone call needs a live WebSocket held open for its whole
duration — Vercel (where the app runs) can't do that, but a small always-on host
can.

```
Caller ──▶ Twilio (speech⇄text) ──WebSocket──▶ THIS server ──▶ Claude (Haiku)
                                                     │
                                                     └─▶ clipwise.ca API (availability + book)
```

## What it does
- Loads the shop's services, barbers, and availability from your app.
- Talks the caller through booking with Claude (short, natural replies).
- Books the appointment through your app's secure API (the booking shows up on the
  calendar and texts the customer, exactly like any other booking).

## Deploy (≈10 minutes)

1. **Pick a host** that stays always-on: [Railway](https://railway.app),
   [Render](https://render.com), or [Fly.io](https://fly.io) (~$5–7/mo). Vercel
   will **not** work for this piece.

2. **Deploy this `voice-server/` folder.** Start command: `npm start`.

3. **Set the environment variables** (see `.env.example`):
   - `ANTHROPIC_API_KEY` — your Claude key.
   - `CLIPWISE_URL` — `https://clipwise.ca`.
   - `AI_PHONE_SECRET` — a long random string. **Set the exact same value in
     Vercel** (Settings → Environment Variables) so the two trust each other.

4. **Grab the server's public URL** and turn it into a `wss://` URL, e.g.
   `wss://clipwise-voice.up.railway.app`. In **Vercel**, set
   `TWILIO_CONVERSATION_RELAY_URL` to that URL, then redeploy the app.

That's it. When a customer calls a shop's ClipWise Business Number, the app's
voice webhook hands the call to this server, and the AI books them in.

## Notes
- **Model:** defaults to `claude-haiku-4-5` (fast + cheap — the right tier for
  voice). Change with `CLAUDE_MODEL` if you ever want more capability.
- **Safety net:** if this server is down or `TWILIO_CONVERSATION_RELAY_URL` isn't
  set, the app automatically falls back to "sorry we missed you" + a booking-link
  text — a call is never dropped silently.
- **Cost per call** is roughly: Twilio voice + a few cents of Claude Haiku. Keep
  an eye on it as volume grows.
