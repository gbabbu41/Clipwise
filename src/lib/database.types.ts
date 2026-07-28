export type UserRole = "customer" | "barber" | "shop_owner" | "super_admin";
export type ShopStatus = "pending" | "approved" | "rejected" | "suspended";
export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no-show";
export type PaymentMethod = "card" | "cash" | "online";
export type SubscriptionPlan = "starter" | "pro" | "premium" | "business";
export type DiscountType = "percent" | "fixed";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  avatar?: string;
  created_at: string;
}

export interface Shop {
  id: string;
  name: string;
  address: string;
  city: string;
  province: string;
  postal_code: string;
  phone: string;
  email: string;
  owner_id: string;
  logo?: string;
  description?: string;
  slug: string;
  stripe_account_id?: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  subscription_status?: "active" | "cancelled" | "past_due" | "inactive";
  stripe_connected?: boolean;
  stripe_connect_status?: "pending" | "active";
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  youtube?: string;
  website?: string;
  subscription_plan: SubscriptionPlan;
  is_active: boolean;
  status: ShopStatus;
  /** IANA timezone (e.g. "America/Toronto"). Drives server-side same-day slot
   *  filtering + reminder scheduling in the shop's local time. */
  timezone?: string;
  rejection_reason?: string;
  notification_templates?: Record<string, { subject: string; body: string }>;
  google_place_id?: string;
  /** When true, customers see a "Pay in person at the shop" option at
   *  booking time. When false, only online Stripe checkout is offered. */
  allow_pay_in_person?: boolean;
  /** Booking-flow config (advance window, cancellation, deposit, no-show).
   *  Stored as a JSON blob; only the fields read at runtime are typed here. */
  booking_settings?: {
    no_show_protection?: boolean;
    no_show_fee_percent?: number; // % of the booked total to charge a no-show (0–80)
    no_show_fee_amount?: number;  // legacy (flat $) — no longer written; kept for old blobs
    [key: string]: unknown;
  };
  created_at: string;
}

// Per-barber toggles for what that barber can do in their portal.
// Default (when the column is absent or null): all true.
export interface BarberPermissions {
  edit_schedule: boolean;
  request_time_off: boolean;
  view_earnings: boolean;
  view_clients: boolean;
  block_hours: boolean;
  /** When true, the barber can Approve / Complete / Reject / Take Payment
   *  on appointments assigned to them from the barber-portal Schedule tab.
   *  When false (default for new barbers), Schedule stays read-only and
   *  only the shop owner can move appointments through their lifecycle. */
  manage_appointments: boolean;
}

export const DEFAULT_BARBER_PERMISSIONS: BarberPermissions = {
  edit_schedule: true,
  request_time_off: true,
  view_earnings: true,
  view_clients: true,
  block_hours: true,
  // Off by default — granting payment-collection authority is a deliberate
  // act the shop owner has to do per barber.
  manage_appointments: false,
};

export interface Barber {
  id: string;
  user_id?: string;
  shop_id: string;
  name: string;
  email?: string;
  bio?: string;
  photo?: string;
  is_active: boolean;
  commission_percent: number;
  rating: number;
  total_reviews: number;
  permissions?: BarberPermissions;
  created_at: string;
}

export interface TimeSlot {
  id: string;
  barber_id: string;
  day_of_week: number; // 0=Sun, 1=Mon ... 6=Sat
  start_time: string;  // "09:00:00"
  end_time: string;    // "19:00:00"
  is_available: boolean;
}

export interface Service {
  id: string;
  shop_id: string;
  name: string;
  price: number;
  duration_minutes: number;
  description?: string;
  category: string;
  is_active: boolean;
  deposit_required?: boolean;
  deposit_amount?: number;
}

export interface Appointment {
  id: string;
  shop_id: string;
  barber_id: string;
  service_id: string;
  customer_id?: string;
  client_name: string;
  client_email: string;
  client_phone: string;
  date: string;         // "YYYY-MM-DD"
  time_slot: string;    // "9:00 AM"
  status: AppointmentStatus;
  notes?: string;
  deposit_paid: boolean;
  total_amount: number;
  /** Authoritative block length in minutes. Set for multi-service bookings
   *  (sum of all picked services). When absent, fall back to the linked
   *  service's duration_minutes. */
  duration_minutes?: number;
  /** Tip + sales tax captured with the booking (phase30). total_amount INCLUDES
   *  tax; subtract tax_amount for pre-tax service revenue. */
  tip_amount?: number;
  tax_amount?: number;
  payment_method?: PaymentMethod;
  payment_status?: "paid" | "failed" | "refunded" | "unpaid" | "held" | "captured" | "saved" | "voided";
  payment_intent_id?: string;
  /** Stripe Checkout session for a sent payment/checkout link. Its presence on an
   *  unpaid row drives the "Awaiting payment" tag (see paymentTag). */
  stripe_checkout_session_id?: string;
  /** When the payment actually landed (paid / captured). Drives the
   *  "Paid · 10 min ago" relative labels. Set wherever we flip to paid. */
  paid_at?: string;
  no_show_fee_amount?: number; // cents captured for a no-show (Phase 1)
  // Phase 2 — saved card (off-session) for bookings >7 days out: the card is
  // stored at booking and charged on completion / no-show via these.
  stripe_customer_id?: string;
  stripe_payment_method_id?: string;
  created_at: string;
}

export interface AppointmentWithDetails extends Appointment {
  barbers?: { id: string; name: string };
  services?: { id: string; name: string; price: number; duration_minutes: number; category: string };
}

export interface Client {
  id: string;
  shop_id: string;
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
  total_visits: number;
  total_spent: number;
  last_visit?: string;
  preferred_barber_id?: string;
  loyalty_points: number;
  tag: "New" | "Returning" | "VIP" | "At Risk";
  birthday?: string;
  marketing_opt_out?: boolean;
}

export interface Transaction {
  id: string;
  shop_id: string;
  appointment_id?: string;
  barber_id?: string;
  client_name?: string;
  service_name?: string;
  amount: number;              // pre-tax service/product revenue
  tip: number;
  tax?: number;                // sales tax collected on this sale (phase30)
  commission_amount?: number;
  payment_method?: PaymentMethod;
  type: "service" | "product" | "tip";
  refunded?: boolean;
  payment_intent_id?: string | null;
  source?: string | null;
  created_at: string;
}

export interface InventoryItem {
  id: string;
  shop_id: string;
  name: string;
  category?: string;
  price: number;
  cost_price?: number;
  quantity: number;
  low_stock_threshold: number;
}

export interface PromoCode {
  id: string;
  shop_id: string;
  code: string;
  discount_type: DiscountType;
  discount_value: number;
  uses_left?: number;
  total_uses: number;
  expires_at?: string;
  is_active: boolean;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: "booking" | "cancellation" | "no-show" | "review" | "inventory" | "system";
  is_read: boolean;
  created_at: string;
}

export interface Review {
  id: string;
  shop_id: string;
  barber_id?: string;
  client_id?: string;
  client_name?: string;
  rating: number;
  comment?: string;
  reply?: string;
  created_at: string;
}

export interface WaitlistEntry {
  id: string;
  shop_id: string;
  barber_id?: string;
  client_name: string;
  client_phone: string;
  service_id?: string;
  added_at: string;
  status: "waiting" | "called" | "served" | "removed";
}

// Smart waitlist: a customer asking to be notified when a spot opens on a
// fully-booked day. Distinct from WaitlistEntry (the in-shop walk-in queue).
export interface AppointmentWaitlistEntry {
  id: string;
  shop_id: string;
  barber_id?: string;   // null = any barber
  service_id?: string;
  client_name: string;
  client_email?: string;
  client_phone?: string;
  desired_date: string; // "YYYY-MM-DD"
  status: "waiting" | "notified" | "converted" | "cancelled";
  notified_at?: string;
  created_at: string;
}

export interface DaySchedule {
  isOpen: boolean;
  startTime: string; // display: "9:00 AM"
  endTime: string;   // display: "7:00 PM"
}

export interface Message {
  id: string;
  shop_id: string;
  client_id?: string;
  client_name: string;
  client_phone?: string;
  sender: "shop" | "client";
  content: string;
  is_read: boolean;
  created_at: string;
}
