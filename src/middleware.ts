import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isNativeRequest } from "@/lib/native-app";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Native app (Apple IAP): the ClipWise SUBSCRIPTION has NO surface in the app.
  // Apple requires digital subscriptions sold inside an app to use In-App Purchase;
  // we don't, so the app must never show pricing / plans / upgrade / signup / the
  // billing portal. Block them at the router so they're unreachable by deep link,
  // back-nav, or a stale URL — barbers subscribe on clipwise.ca and just log in
  // here. (This gates ONLY ClipWise's own subscription. The barber's real-world
  // money — service prices, POS, Terminal card payments, revenue — stays visible.)
  if (isNativeRequest(request)) {
    // Marketing/landing (has pricing) → into the app proper. /dashboard is
    // auth-gated below, so a logged-out visitor bounces on to /login from there.
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    // Signup lives on the website only; app users already have accounts.
    if (pathname === "/signup") {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    // Subscription billing + plan-picker → back to a neutral in-app page.
    if (
      pathname === "/dashboard/billing" || pathname.startsWith("/dashboard/billing/") ||
      pathname === "/onboarding/plan"   || pathname.startsWith("/onboarding/plan/")
    ) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  // Public routes — no auth needed
  const publicPaths = ["/", "/login", "/signup", "/forgot-password", "/admin/login"];
  const isPublic =
    publicPaths.includes(pathname) ||
    pathname.startsWith("/book/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon");

  if (isPublic) return NextResponse.next();

  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Not authenticated → redirect to login, REMEMBERING where they were headed
  // (e.g. a /dashboard/appointments link from an email) so login can send them
  // back there instead of dumping them on the dashboard home.
  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // /admin/login is in publicPaths above, so it stays reachable; every other
  // /admin page now gets the same auth gate + destination memory as the portals.
  // "/" and "/signup" are matched too so the native-app billing redirects above can
  // fire on them; both stay in publicPaths so web users keep the fast early-return.
  matcher: ["/", "/signup", "/dashboard/:path*", "/onboarding/:path*", "/barber-dashboard/:path*", "/admin/:path*"],
};
