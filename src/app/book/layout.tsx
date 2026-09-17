import { PublicBookingIdentity } from "@/components/marketing/public-booking-identity";
export default function PublicBookingLayout({ children }: { children: React.ReactNode }) {
  return <div className="public-booking"><PublicBookingIdentity />{children}</div>;
}
