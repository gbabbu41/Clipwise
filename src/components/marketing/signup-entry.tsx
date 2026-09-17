"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const CSS = `
.mkt .signup-entry{color:#f5f4f7;background:#000;border:1px solid #303037;border-radius:20px;width:min(460px,calc(100% - 32px));padding:36px;max-height:calc(100dvh - 32px);overflow:auto;box-shadow:0 24px 90px #0008}
.mkt .signup-entry::backdrop{background:#000b;backdrop-filter:blur(5px)}
.mkt .signup-entry .entry-close{position:absolute;right:14px;top:12px;background:none;border:0;color:#b8b8c2;font-size:24px;width:44px;height:44px;cursor:pointer}
.mkt .signup-entry h2{font-size:32px;line-height:1.15;margin:16px 0}.mkt .signup-entry p{font-size:14px;line-height:1.7;color:#b8b8c2}
.mkt .signup-entry label{display:block;font-size:13px;margin:24px 0 8px}.mkt .signup-entry input[type=email]{display:block;width:100%;min-height:50px;background:#0b0b0d;border:1px solid #34343b;border-radius:10px;padding:12px;color:#fff;font:inherit;font-size:16px}
.mkt .signup-entry .pill{width:100%;border:0;cursor:pointer;margin-top:16px}.mkt .signup-entry .pill:disabled{opacity:.55;cursor:wait}
.mkt .signup-entry .entry-note{font-size:12px;color:#a2a2ad;margin:16px 0 0}.mkt .signup-entry .entry-note a{text-decoration:underline;text-underline-offset:3px}.mkt .signup-entry .entry-error{color:#ffb4b4;font-size:13px}
.mkt .signup-entry .entry-trap{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
@media(max-width:480px){.mkt .signup-entry{padding:28px 22px}.mkt .signup-entry h2{font-size:28px}}
`;

// Enhance ordinary signup links; without JS they still reach the signup page.
// Native dialog provides keyboard focus containment and Escape dismissal.
export function SignupEntry({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState("starter");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [website, setWebsite] = useState("");
  useEffect(() => () => request.current?.abort(), []);
  const close = () => { request.current?.abort(); request.current = null; setBusy(false); setEmail(""); setError(""); dialog.current?.close(); };

  function intercept(e: React.MouseEvent<HTMLDivElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !(e.target instanceof Element)) return;
    const link = e.target.closest<HTMLAnchorElement>("a[href]");
    if (!link || link.hasAttribute("data-direct-signup") || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== "/signup") return;
    if (!dialog.current?.showModal) return;
    e.preventDefault();
    const selected = url.searchParams.get("plan");
    setPlan(selected === "pro" || selected === "premium" ? selected : "starter");
    setError("");
    dialog.current.showModal();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/marketing/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, plan, website }), signal: controller.signal });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || result.ok !== true) { setError(result.error || "Please try again."); return; }
      // Navigation destination is built from our validated plan, never server/user URLs.
      dialog.current?.close(); setEmail("");
      router.push(`/signup?plan=${plan}`);
    } catch { if (request.current === controller && dialog.current?.open) setError("We couldn’t connect. Try again, or continue directly to signup."); }
    finally { clearTimeout(timeout); if (request.current === controller) { request.current = null; setBusy(false); } }
  }

  return <div style={{ display: "contents" }} onClickCapture={intercept}>
    {children}
    <style dangerouslySetInnerHTML={{ __html: CSS }} />
    <dialog ref={dialog} className="signup-entry" aria-labelledby="signup-entry-title" aria-describedby="signup-entry-description" onCancel={close} onClose={() => { if (!dialog.current?.open) { request.current?.abort(); request.current = null; setBusy(false); } }}>
      <button type="button" className="entry-close" aria-label="Close signup form" onClick={close}>×</button>
      <p className="eyebrow">Your shop starts here</p><h2 id="signup-entry-title">First, your email.</h2><p id="signup-entry-description">Then a few details to create your account.</p>
      <form onSubmit={submit}>
        <label htmlFor="signup-entry-email">Email address</label><input id="signup-entry-email" type="email" autoComplete="email" autoFocus required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={busy} />
        <div className="entry-trap" aria-hidden="true"><label htmlFor="signup-entry-website">Leave this field empty</label><input id="signup-entry-website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></div>
        {error && <p role="alert" className="entry-error">{error}</p>}
        <button type="submit" className="pill w" disabled={busy}>{busy ? "Continuing…" : "Continue →"}</button>
        <p className="entry-note">We save your email to support signup. Unused signup records are cleaned up after 30 days. This does not subscribe you to marketing. <a href="/privacy">Privacy policy</a></p>
        <p className="entry-note">Already registered? <a href="/login">Log in</a>{error && <> · <a data-direct-signup href={`/signup?plan=${plan}`}>Continue directly to signup</a></>}</p>
      </form>
    </dialog>
  </div>;
}
