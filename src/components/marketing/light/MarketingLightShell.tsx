import Link from "next/link";
import type { ReactNode } from "react";
import { SignupEntry } from "../signup-entry";
import styles from "./page.module.css";

const SIGNUP_ENTRY_THEME = `
.mkt.lightMarketing{color:#101d2e}
.mkt.lightMarketing .eyebrow{margin:0;color:#657386;font-size:10px;font-weight:700;letter-spacing:.14em;line-height:1.5;text-transform:uppercase}
.mkt.lightMarketing .pill{display:inline-flex;min-height:44px;align-items:center;justify-content:center;gap:10px;padding:0 18px;border:1px solid #101d2e;border-radius:5px;color:#fff;background:#101d2e;font-family:inherit;font-size:13px;font-weight:700;line-height:1.2;text-align:center;text-decoration:none;cursor:pointer}
.mkt.lightMarketing .pill.w{color:#fff;background:#101d2e}
.mkt.lightMarketing .signup-entry{color:#101d2e;background:#fff;border:1px solid #d7dee7;border-radius:14px;box-shadow:0 24px 70px rgb(16 29 46 / 18%)}
.mkt.lightMarketing .signup-entry p{color:#596575}
.mkt.lightMarketing .signup-entry .entry-close{color:#596575}
.mkt.lightMarketing .signup-entry input[type=email]{color:#101d2e;background:#fff;border-color:#bfc9d5}
.mkt.lightMarketing .signup-entry input[type=email]:focus{outline:3px solid rgb(23 104 203 / 28%);border-color:#1768cb}
.mkt.lightMarketing .signup-entry .entry-note a{color:#1768cb}
.mkt.lightMarketing :focus-visible{outline:3px solid #73a8e9;outline-offset:3px}
`;

export function MarketingLightShell({ children }: { children: ReactNode }) {
  return (
    <div className="mkt lightMarketing">
      <style dangerouslySetInnerHTML={{ __html: SIGNUP_ENTRY_THEME }} />
      <SignupEntry>
        <a className={styles.skipLink} href="#public-main">Skip to content</a>
        <div id="top" className={styles.page}>
          <header className={styles.nav}>
            <Link href="/" className={styles.wordmark} aria-label="ClipWise home">CLIPWISE</Link>
            <nav aria-label="Main navigation" className={styles.links}>
              <a href="/#product">Product</a>
              <a href="/#plans">Pricing</a>
              <Link href="/login">Log in</Link>
            </nav>
            <Link href="/signup" className={styles.navCta}>Get started</Link>
          </header>
          {children}
          <footer className={styles.footer}>
            <Link href="/" className={styles.wordmark}>CLIPWISE</Link>
            <span>Barbershop software, built for Canadian shops.</span>
            <nav aria-label="Footer" className={styles.footerLinks}>
              <Link href="/pricing">Pricing</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <a href="mailto:support@clipwise.ca">Contact</a>
            </nav>
          </footer>
        </div>
      </SignupEntry>
    </div>
  );
}
