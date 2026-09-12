import { headers } from "next/headers";
import { isNativeUserAgent } from "@/lib/native-app";
import LoginForm from "./login-form";

/**
 * Server wrapper: reads the request User-Agent so the native app (Apple IAP) is
 * detected on the server and the "Sign up" line is never sent to it — no flash,
 * no DOM node. Everything else lives in the client <LoginForm>.
 */
export default function LoginPage() {
  const native = isNativeUserAgent(headers().get("user-agent"));
  return <LoginForm native={native} />;
}
