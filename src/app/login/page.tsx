import { headers } from "next/headers";
import { isNativeUserAgent } from "@/lib/native-app";
import { AuthShell } from "@/components/marketing/auth-shell";
import LoginForm from "./login-form";

/**
 * Server wrapper: reads the request User-Agent so the native app (Apple IAP) is
 * detected on the server and the "Sign up" line is never sent to it — no flash,
 * no DOM node. The themed chrome comes from AuthShell; the form logic lives in
 * the client <LoginForm>.
 */
export default function LoginPage() {
  const native = isNativeUserAgent(headers().get("user-agent"));
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your ClipWise account" showBack={!native}>
      <LoginForm native={native} />
    </AuthShell>
  );
}
