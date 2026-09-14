import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MKT_CSS } from "@/lib/marketing-theme";

// Themed chrome for the public auth / entry pages (login, signup, password,
// join). Same black/emerald theme as the rest of the public site, but a MINIMAL
// header — just the CLIPWISE wordmark — with no pricing/sign-up nav, because the
// login screen renders inside the native app (Apple IAP) and its chrome must not
// advertise billing. The old gradient logo watermark is gone; the wordmark is
// plain white, matching the nav and footer.
export function AuthShell({
  title, subtitle, children, wide = false, showBack = true,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  wide?: boolean;
  showBack?: boolean;
}) {
  return (
    <div className="mkt">
      <style dangerouslySetInnerHTML={{ __html: MKT_CSS }} />
      <div className="authwrap">
        <div className="authbrand">
          <Link href="/" className="wm">CLIPWISE</Link>
          {title && <h1>{title}</h1>}
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className={`authcard${wide ? " wide" : ""}`}>{children}</div>
        {showBack && <Link href="/" className="authback"><ArrowLeft size={14} /> Back to home</Link>}
      </div>
    </div>
  );
}
