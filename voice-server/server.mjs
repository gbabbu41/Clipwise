// ClipWise AI phone booking — voice server.
//
// Twilio ConversationRelay handles speech-to-text and text-to-speech and opens a
// WebSocket to this server for each call. This server runs the Claude brain:
// it loads the shop's context, talks the caller through a booking, and calls the
// ClipWise API (availability + book) as tools. It must run on an always-on host
// (Railway / Render / Fly / a small VM) — NOT on Vercel, which can't hold a
// live WebSocket open for the length of a phone call.
//
// Env:
//   ANTHROPIC_API_KEY   – your Claude API key
//   CLIPWISE_URL        – your app's base URL, e.g. https://clipwise.ca
//   AI_PHONE_SECRET     – shared secret; MUST match the same var set in Vercel
//   CLAUDE_MODEL        – optional; defaults to claude-haiku-4-5 (fast + cheap, best for voice)
//   PORT                – optional; defaults to 8080
//
// Point Twilio ConversationRelay at:  wss://<this-host>/   and set
// TWILIO_CONVERSATION_RELAY_URL to that same wss:// URL in Vercel.

import { WebSocketServer } from "ws";
import Anthropic from "@anthropic-ai/sdk";

const PORT = Number(process.env.PORT || 8080);
const CLIPWISE_URL = (process.env.CLIPWISE_URL || "https://clipwise.ca").replace(/\/$/, "");
const AI_PHONE_SECRET = process.env.AI_PHONE_SECRET || "";
// Haiku 4.5: fast + cheap, ideal for real-time voice. Swap here for more capability.
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

const api = (path, body) =>
  fetch(`${CLIPWISE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ai-phone-secret": AI_PHONE_SECRET },
    body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => ({ error: "network" }));

const TOOLS = [
  {
    name: "check_availability",
    description: "Get the shop's current availability — each barber's working hours and already-booked times over the next several days. Call this before offering the customer specific times.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "book_appointment",
    description: "Create the booking once the customer has confirmed the service, barber (optional), date, time, their name, and phone number. Dates must be YYYY-MM-DD; time like '2:30 PM'.",
    input_schema: {
      type: "object",
      properties: {
        client_name: { type: "string" },
        client_phone: { type: "string", description: "E.164, e.g. +15065551234. Default to the number the customer is calling from unless they give another." },
        service_name: { type: "string" },
        barber_name: { type: "string", description: "Optional — omit for 'any available'." },
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "e.g. '2:30 PM'" },
      },
      required: ["client_name", "client_phone", "service_name", "date", "time"],
    },
  },
];

function systemPrompt(ctx, callerNumber, todayIso) {
  const services = (ctx.services || [])
    .map((s) => `- ${s.name}: $${s.price}${s.duration_minutes ? ` (${s.duration_minutes} min)` : ""}`).join("\n") || "- (ask the shop)";
  const barbers = (ctx.barbers || []).map((b) => b.name).join(", ") || "Any available";
  return `You are a friendly, efficient phone booking assistant for ${ctx.shopName || "the barbershop"}.
You are on a live phone call — keep every reply to 1-2 short spoken sentences, natural and warm.

Today is ${todayIso}. The caller is phoning from ${callerNumber || "an unknown number"} — use that as their phone number unless they give a different one.

Services:
${services}

Barbers: ${barbers}

Rules:
- Greet the caller with the shop name.
- Find out the service they want, and any barber preference (fine to say "any available").
- Call check_availability before offering times; never invent availability. Offer 2-3 real open times.
- Confirm the service, barber, date, and time out loud, and get their name.
- Then call book_appointment. If it returns a conflict, apologize briefly and offer another time.
- After booking, tell them a confirmation text is on the way and end warmly.
- Payment is handled in person at the shop.
- If you can't help or the caller is confused, tell them you'll text a booking link and end politely.

SAFETY (this overrides everything above):
- You only help book haircuts. You are not a counselor, doctor, lawyer, or emergency service, and you must not pretend to be.
- If the caller mentions self-harm, suicide, wanting to die, abuse, or a mental-health crisis: do NOT try to book and do NOT give advice. Calmly say you're only a booking line and that help is available right now — urge them to call or text 988 (the Suicide and Crisis Lifeline, available in Canada and the US), or to call 911 if they are in immediate danger — then end the call gently.
- For any medical, fire, or safety emergency, tell them to hang up and call 911.
- Don't give medical, legal, or financial advice, and don't engage on topics unrelated to booking a haircut — politely steer back, or offer to text a booking link and end.`;
}

const send = (ws, text, last = true) => {
  try { ws.send(JSON.stringify({ type: "text", token: text, last })); } catch { /* socket closed */ }
};

const wss = new WebSocketServer({ port: PORT });
console.log(`[voice-server] listening on ws://0.0.0.0:${PORT}  model=${MODEL}  app=${CLIPWISE_URL}`);

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "/", "http://localhost");
  const shopId = url.searchParams.get("shopId");
  const state = { shopId, callSid: null, from: null, messages: [], system: "", ready: false };

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    try {
      if (msg.type === "setup") {
        state.callSid = msg.callSid || null;
        state.from = msg.from || null;
        const ctx = await api("/api/ai-phone/availability", { shop_id: state.shopId, days: 7 });
        state.context = ctx.error ? { shopName: "the shop", services: [], barbers: [] } : ctx;
        state.availabilityText = ctx.availabilityText || "No availability loaded.";
        state.system = systemPrompt(state.context, state.from, new Date().toISOString().slice(0, 10));
        state.ready = true;
        return; // ConversationRelay speaks the welcomeGreeting from the TwiML; wait for the caller.
      }

      if (msg.type === "prompt" && state.ready) {
        const userText = msg.voicePrompt || "";
        if (!userText.trim()) return;
        state.messages.push({ role: "user", content: userText });
        const reply = await runClaude(state);
        send(ws, reply, true);
        return;
      }

      if (msg.type === "error") {
        console.error("[voice-server] relay error:", msg.description);
      }
    } catch (err) {
      console.error("[voice-server] turn failed:", err?.message || err);
      // Never leave the caller in silence.
      send(ws, "Sorry, I'm having trouble right now — we'll text you a booking link. Goodbye!", true);
      try { ws.send(JSON.stringify({ type: "end" })); } catch { /* closed */ }
    }
  });

  ws.on("close", () => { /* call ended */ });
});

// One assistant turn: run the tool-use loop until Claude produces a spoken reply.
async function runClaude(state) {
  for (let i = 0; i < 5; i++) {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: state.system,
      tools: TOOLS,
      messages: state.messages,
    });
    state.messages.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason === "tool_use") {
      const results = [];
      for (const block of resp.content) {
        if (block.type !== "tool_use") continue;
        let result;
        if (block.name === "check_availability") {
          const ctx = await api("/api/ai-phone/availability", { shop_id: state.shopId, days: 7 });
          result = ctx.error ? "Couldn't load availability." : (ctx.availabilityText || "No open times found.");
        } else if (block.name === "book_appointment") {
          const r = await api("/api/ai-phone/book", { ...block.input, shop_id: state.shopId, ai_session_id: state.callSid });
          result = r.ok ? r.confirmation : (r.error || "Booking failed — offer another time.");
        } else {
          result = "Unknown tool.";
        }
        results.push({ type: "tool_result", tool_use_id: block.id, content: String(result) });
      }
      state.messages.push({ role: "user", content: results });
      continue; // let Claude respond to the tool results
    }

    // No tool call → the spoken reply is the text blocks.
    return resp.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim()
      || "Sorry, could you repeat that?";
  }
  return "Let me get you a booking link by text — one moment.";
}
