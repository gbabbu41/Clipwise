import { redirect } from "next/navigation";

// The old standalone shop-profile page (Services/Barbers/Reviews tabs) is retired
// — the polished booking page at /book/[slug] is the one public shop page now.
// Redirect so any previously shared /shops/<slug> links still land on it.
export default function ShopProfileRedirect({ params }: { params: { slug: string } }) {
  redirect(`/book/${params.slug}`);
}
