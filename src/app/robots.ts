import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard/", "/barber-dashboard/", "/admin/", "/onboarding/", "/my-booking/", "/receipt/", "/signup", "/login", "/reset-password"] }, sitemap: "https://clipwise.ca/sitemap.xml" };
}
