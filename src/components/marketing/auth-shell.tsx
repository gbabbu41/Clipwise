import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MKT_CSS } from "@/lib/marketing-theme";
import { PublicIdentity } from "./public-identity";

const LIGHT_AUTH_CSS = `
.mkt.public-site.light-auth{--bg:#f5f7fa;--s1:#fff;--s2:#eef2f6;--line:#d7dee7;--line2:#bfc9d5;--t1:#101d2e;--t2:#354255;--t3:#596575;--t4:#657386;--ok:#234b70;background:#f5f7fa;color:#101d2e}
.mkt.public-site.light-auth .authbrand .wm,.mkt.public-site.light-auth .authbrand h1{color:#101d2e}
.mkt.public-site.light-auth .authbrand p,.mkt.public-site.light-auth .authback{color:#596575}
.mkt.public-site.light-auth .authcard{background:#fff!important;border:1px solid #d7dee7!important;border-radius:14px!important;padding:clamp(22px,4vw,30px)!important;box-shadow:0 12px 32px rgb(16 29 46 / 7%)}
.mkt.public-site.light-auth .authcard input,.mkt.public-site.light-auth .authcard select,.mkt.public-site.light-auth .authcard textarea{min-height:48px;background:#fff;color:#101d2e;border-color:#bfc9d5}
.mkt.public-site.light-auth .authcard input::placeholder,.mkt.public-site.light-auth .authcard textarea::placeholder{color:#657386}
.mkt.public-site.light-auth .authcard input:focus,.mkt.public-site.light-auth .authcard select:focus,.mkt.public-site.light-auth .authcard textarea:focus{outline:3px solid rgb(23 104 203 / 24%);outline-offset:1px;border-color:#1768cb}
.mkt.public-site.light-auth .field label{color:#354255}
.mkt.public-site.light-auth .field .ip .lic,.mkt.public-site.light-auth .field .eye{color:#657386}
.mkt.public-site.light-auth .authrow a,.mkt.public-site.light-auth .authfoot,.mkt.public-site.light-auth .authback{color:#596575}
.mkt.public-site.light-auth .authfoot a,.mkt.public-site.light-auth .authrow a{color:#1768cb}
.mkt.public-site.light-auth .authrow a:hover{color:#124f9b}
.mkt.public-site.light-auth .pill.w{color:#fff;background:#101d2e}
.mkt.public-site.light-auth .logo-fb{background:#eef2f6!important;border-color:#d7dee7!important}
.mkt.public-site.light-auth .logo-fb[style*="255,90,90"]{background:#fff1f0!important;border-color:#efc1bd!important}
.mkt.public-site.light-auth .logo-fb svg[style*="ff8a8a"]{color:#ad2c2c!important}
.mkt.public-site.light-auth .err{color:#9f2525;background:#fff1f0;border-color:#efc1bd}
.mkt.public-site.light-auth .ok{color:#245435;background:#e8f3ec;border-color:#b5d5bf}
.mkt.public-site.light-auth :focus-visible{outline:3px solid #73a8e9;outline-offset:3px}
`;

// Minimal chrome for auth / entry pages. Website auth uses the light public
// presentation; native login opts out to retain its billing-safe dark screen.
// There is no pricing/sign-up navigation here because native login must not
// advertise billing.
export function AuthShell({
  title, subtitle, children, wide = false, showBack = true, light = true,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  wide?: boolean;
  showBack?: boolean;
  light?: boolean;
}) {
  return (
    <div className={`mkt public-site${light ? " light-auth" : ""}`}>
      <style dangerouslySetInnerHTML={{ __html: MKT_CSS }} />
      <PublicIdentity />
      {light && <style dangerouslySetInnerHTML={{ __html: LIGHT_AUTH_CSS }} />}
      <main className="authwrap">
        <div className="authbrand">
          <Link href="/" className="wm">CLIPWISE</Link>
          {title && <h1>{title}</h1>}
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className={`authcard${wide ? " wide" : ""}`}>{children}</div>
        {showBack && <Link href="/" className="authback"><ArrowLeft size={14} /> Back to home</Link>}
      </main>
    </div>
  );
}
