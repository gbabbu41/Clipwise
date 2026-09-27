"use client";
import BookingClient from "../../book/[shopslug]/booking-client";
import LuxuryLanding from "./luxury-landing";
export default function PreviewClient() {
  return <div className="shop-luxury"><BookingClient Landing={LuxuryLanding} presentation="luxury" /></div>;
}
