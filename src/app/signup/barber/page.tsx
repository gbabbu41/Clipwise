import { redirect } from "next/navigation";

// ClipWise has a single sign-up flow. A barber and a shop owner are the same
// kind of account — the difference is only the plan they pick (a solo barber on
// Pro can add a shop + team anytime). This legacy route just forwards to it so
// old links/bookmarks don't 404.
export default function BarberSignupRedirect() {
  redirect("/signup");
}
