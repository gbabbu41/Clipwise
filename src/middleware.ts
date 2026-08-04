import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
  matcher: ["/dashboard/:path*", "/onboarding/:path*", "/barber-dashboard/:path*", "/admin/:path*"],
};
