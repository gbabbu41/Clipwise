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
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  youtube?: string;
  website?: string;
  subscription_plan: SubscriptionPlan;
  is_active: boolean;
  status: ShopStatus;
  rejection_reason?: string;
  notification_templates?: Record<string, { subject: string; body: string }>;
  google_place_id?: string;
  created_at: string;
}

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
  payment_method?: PaymentMethod;
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
}

export interface Transaction {
  id: string;
  shop_id: string;
  appointment_id?: string;
  barber_id?: string;
  client_name?: string;
  service_name?: string;
  amount: number;
  tip: number;
  commission_amount?: number;
  payment_method?: PaymentMethod;
  type: "service" | "product" | "tip";
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
