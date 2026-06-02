export const mockShop = {
  id: "shop-1",
  name: "Fresh Cutz Barbershop",
  address: "123 Main Street",
  city: "Moncton",
  province: "NB",
  postal_code: "E1C 1A1",
  phone: "(506) 555-0123",
  email: "info@freshcutz.ca",
  slug: "fresh-cutz",
  description: "Moncton's premium barbershop experience. Fresh fades, clean lines, classic cuts.",
  rating: 4.8,
  total_reviews: 127,
  subscription_plan: "Pro",
  is_active: true,
  hours: {
    Monday: { open: "9:00 AM", close: "7:00 PM", closed: false },
    Tuesday: { open: "9:00 AM", close: "7:00 PM", closed: false },
    Wednesday: { open: "9:00 AM", close: "7:00 PM", closed: false },
    Thursday: { open: "9:00 AM", close: "8:00 PM", closed: false },
    Friday: { open: "9:00 AM", close: "8:00 PM", closed: false },
    Saturday: { open: "8:00 AM", close: "6:00 PM", closed: false },
    Sunday: { open: "10:00 AM", close: "4:00 PM", closed: false },
  },
};

export const mockBarbers = [
  {
    id: "barber-1",
    user_id: "user-1",
    name: "Marcus Johnson",
    email: "marcus@freshcutz.ca",
    photo: "https://i.pravatar.cc/150?img=11",
    bio: "Master barber with 8+ years of experience. Specializes in skin fades and beard sculpting.",
    rating: 4.9,
    total_reviews: 89,
    commission_percent: 50,
    is_active: true,
    appointments_this_month: 87,
    revenue_this_month: 2610,
    commission_earned: 1305,
    specialties: ["Skin Fade", "Beard Trim", "Line Up"],
  },
  {
    id: "barber-2",
    user_id: "user-2",
    name: "Tyler Smith",
    email: "tyler@freshcutz.ca",
    photo: "https://i.pravatar.cc/150?img=12",
    bio: "Creative cuts specialist. Known for modern styles and exceptional customer service.",
    rating: 4.7,
    total_reviews: 64,
    commission_percent: 45,
    is_active: true,
    appointments_this_month: 72,
    revenue_this_month: 2160,
    commission_earned: 972,
    specialties: ["Kids Cut", "Haircut", "Full Service"],
  },
  {
    id: "barber-3",
    user_id: "user-3",
    name: "James Brown",
    email: "james@freshcutz.ca",
    photo: "https://i.pravatar.cc/150?img=13",
    bio: "Classic cuts with a modern twist. 5 years experience, passionate about the craft.",
    rating: 4.6,
    total_reviews: 41,
    commission_percent: 40,
    is_active: true,
    appointments_this_month: 58,
    revenue_this_month: 1740,
    commission_earned: 696,
    specialties: ["Haircut", "Full Service", "Line Up"],
  },
];

export const mockServices = [
  { id: "svc-1", name: "Haircut", price: 30, duration_minutes: 30, category: "Hair", description: "Classic precision haircut, shaped to perfection.", is_active: true },
  { id: "svc-2", name: "Skin Fade", price: 35, duration_minutes: 45, category: "Hair", description: "High skin fade with crisp lines.", is_active: true },
  { id: "svc-3", name: "Beard Trim", price: 20, duration_minutes: 20, category: "Beard", description: "Shape, trim and edge your beard.", is_active: true },
  { id: "svc-4", name: "Full Service", price: 55, duration_minutes: 60, category: "Packages", description: "Haircut + beard trim combo. Best value!", is_active: true },
  { id: "svc-5", name: "Kids Cut", price: 20, duration_minutes: 25, category: "Hair", description: "For kids 12 and under.", is_active: true },
  { id: "svc-6", name: "Line Up", price: 15, duration_minutes: 15, category: "Hair", description: "Edge up and line up only.", is_active: true },
  { id: "svc-7", name: "Hot Towel Shave", price: 40, duration_minutes: 45, category: "Beard", description: "Traditional straight razor shave with hot towel.", is_active: true },
  { id: "svc-8", name: "Beard Dye", price: 45, duration_minutes: 40, category: "Beard", description: "Color treatment for your beard.", is_active: false },
];

export const mockClients = [
  { id: "cl-1", name: "Devon Williams", email: "devon@email.com", phone: "(506) 555-0201", total_visits: 24, total_spent: 720, last_visit: "2026-05-20", preferred_barber_id: "barber-1", loyalty_points: 240, notes: "Prefers skin fade, always tips well.", tag: "VIP" },
  { id: "cl-2", name: "Alex Thompson", email: "alex@email.com", phone: "(506) 555-0202", total_visits: 12, total_spent: 360, last_visit: "2026-05-18", preferred_barber_id: "barber-2", loyalty_points: 120, notes: "Sensitive scalp, use gentle products.", tag: "Returning" },
  { id: "cl-3", name: "Jordan Lee", email: "jordan@email.com", phone: "(506) 555-0203", total_visits: 3, total_spent: 90, last_visit: "2026-05-22", preferred_barber_id: null, loyalty_points: 30, notes: "", tag: "New" },
  { id: "cl-4", name: "Chris Martinez", email: "chris@email.com", phone: "(506) 555-0204", total_visits: 18, total_spent: 540, last_visit: "2026-03-10", preferred_barber_id: "barber-1", loyalty_points: 180, notes: "VIP client, book priority.", tag: "At Risk" },
  { id: "cl-5", name: "Sam Patel", email: "sam@email.com", phone: "(506) 555-0205", total_visits: 8, total_spent: 240, last_visit: "2026-05-15", preferred_barber_id: "barber-3", loyalty_points: 80, notes: "Kids cut every 3 weeks.", tag: "Returning" },
  { id: "cl-6", name: "Ryan Foster", email: "ryan@email.com", phone: "(506) 555-0206", total_visits: 31, total_spent: 930, last_visit: "2026-05-23", preferred_barber_id: "barber-1", loyalty_points: 310, notes: "Best client, refer friends often.", tag: "VIP" },
  { id: "cl-7", name: "Mike Chen", email: "mike@email.com", phone: "(506) 555-0207", total_visits: 2, total_spent: 60, last_visit: "2026-05-24", preferred_barber_id: null, loyalty_points: 20, notes: "", tag: "New" },
  { id: "cl-8", name: "Jamal Harris", email: "jamal@email.com", phone: "(506) 555-0208", total_visits: 15, total_spent: 450, last_visit: "2026-05-19", preferred_barber_id: "barber-2", loyalty_points: 150, notes: "Full service every visit.", tag: "Returning" },
  { id: "cl-9", name: "Kevin O'Brien", email: "kevin@email.com", phone: "(506) 555-0209", total_visits: 22, total_spent: 660, last_visit: "2026-02-28", preferred_barber_id: "barber-3", loyalty_points: 220, notes: "", tag: "At Risk" },
  { id: "cl-10", name: "Tony Diaz", email: "tony@email.com", phone: "(506) 555-0210", total_visits: 5, total_spent: 150, last_visit: "2026-05-21", preferred_barber_id: "barber-1", loyalty_points: 50, notes: "Allergic to certain hair products.", tag: "Returning" },
  { id: "cl-11", name: "Marcus Webb", email: "marcus.w@email.com", phone: "(506) 555-0211", total_visits: 1, total_spent: 35, last_visit: "2026-05-24", preferred_barber_id: null, loyalty_points: 10, notes: "", tag: "New" },
  { id: "cl-12", name: "DaShawn King", email: "dashawn@email.com", phone: "(506) 555-0212", total_visits: 40, total_spent: 1200, last_visit: "2026-05-23", preferred_barber_id: "barber-1", loyalty_points: 400, notes: "Longest standing client. Always skin fade.", tag: "VIP" },
  { id: "cl-13", name: "Liam Nguyen", email: "liam@email.com", phone: "(506) 555-0213", total_visits: 7, total_spent: 210, last_visit: "2026-05-17", preferred_barber_id: "barber-2", loyalty_points: 70, notes: "", tag: "Returning" },
  { id: "cl-14", name: "Ethan Brooks", email: "ethan@email.com", phone: "(506) 555-0214", total_visits: 9, total_spent: 270, last_visit: "2026-05-20", preferred_barber_id: "barber-3", loyalty_points: 90, notes: "Monthly visit, very punctual.", tag: "Returning" },
  { id: "cl-15", name: "Noah Campbell", email: "noah@email.com", phone: "(506) 555-0215", total_visits: 4, total_spent: 120, last_visit: "2026-04-30", preferred_barber_id: null, loyalty_points: 40, notes: "", tag: "At Risk" },
];

const today = "2026-05-24";

export const mockAppointments = [
  { id: "apt-1", customer_id: "cl-1", barber_id: "barber-1", barber_name: "Marcus Johnson", service_id: "svc-2", service_name: "Skin Fade", client_name: "Devon Williams", client_phone: "(506) 555-0201", date: today, time_slot: "9:00 AM", status: "confirmed", total_amount: 35, payment_method: "card", deposit_paid: true, notes: "Regular client" },
  { id: "apt-2", customer_id: "cl-6", barber_id: "barber-1", barber_name: "Marcus Johnson", service_id: "svc-4", service_name: "Full Service", client_name: "Ryan Foster", client_phone: "(506) 555-0206", date: today, time_slot: "10:00 AM", status: "completed", total_amount: 55, payment_method: "cash", deposit_paid: false, notes: "" },
  { id: "apt-3", customer_id: "cl-3", barber_id: "barber-2", barber_name: "Tyler Smith", service_id: "svc-1", service_name: "Haircut", client_name: "Jordan Lee", client_phone: "(506) 555-0203", date: today, time_slot: "10:30 AM", status: "completed", total_amount: 30, payment_method: "online", deposit_paid: true, notes: "" },
  { id: "apt-4", customer_id: "cl-7", barber_id: "barber-3", barber_name: "James Brown", service_id: "svc-1", service_name: "Haircut", client_name: "Mike Chen", client_phone: "(506) 555-0207", date: today, time_slot: "11:00 AM", status: "confirmed", total_amount: 30, payment_method: "card", deposit_paid: false, notes: "First time client" },
  { id: "apt-5", customer_id: "cl-11", barber_id: "barber-2", barber_name: "Tyler Smith", service_id: "svc-2", service_name: "Skin Fade", client_name: "Marcus Webb", client_phone: "(506) 555-0211", date: today, time_slot: "12:00 PM", status: "pending", total_amount: 35, payment_method: "card", deposit_paid: false, notes: "" },
  { id: "apt-6", customer_id: "cl-12", barber_id: "barber-1", barber_name: "Marcus Johnson", service_id: "svc-2", service_name: "Skin Fade", client_name: "DaShawn King", client_phone: "(506) 555-0212", date: today, time_slot: "1:00 PM", status: "confirmed", total_amount: 35, payment_method: "card", deposit_paid: true, notes: "VIP - priority" },
  { id: "apt-7", customer_id: "cl-8", barber_id: "barber-3", barber_name: "James Brown", service_id: "svc-4", service_name: "Full Service", client_name: "Jamal Harris", client_phone: "(506) 555-0208", date: today, time_slot: "2:00 PM", status: "confirmed", total_amount: 55, payment_method: "cash", deposit_paid: false, notes: "" },
  { id: "apt-8", customer_id: "cl-4", barber_id: "barber-2", barber_name: "Tyler Smith", service_id: "svc-3", service_name: "Beard Trim", client_name: "Chris Martinez", client_phone: "(506) 555-0204", date: today, time_slot: "3:00 PM", status: "no-show", total_amount: 20, payment_method: "card", deposit_paid: false, notes: "" },
  { id: "apt-9", customer_id: "cl-2", barber_id: "barber-1", barber_name: "Marcus Johnson", service_id: "svc-6", service_name: "Line Up", client_name: "Alex Thompson", client_phone: "(506) 555-0202", date: today, time_slot: "4:00 PM", status: "confirmed", total_amount: 15, payment_method: "cash", deposit_paid: false, notes: "" },
  { id: "apt-10", customer_id: "cl-5", barber_id: "barber-3", barber_name: "James Brown", service_id: "svc-5", service_name: "Kids Cut", client_name: "Sam Patel", client_phone: "(506) 555-0205", date: today, time_slot: "5:00 PM", status: "confirmed", total_amount: 20, payment_method: "card", deposit_paid: false, notes: "" },
  // Past appointments
  { id: "apt-11", customer_id: "cl-1", barber_id: "barber-1", barber_name: "Marcus Johnson", service_id: "svc-2", service_name: "Skin Fade", client_name: "Devon Williams", client_phone: "(506) 555-0201", date: "2026-05-20", time_slot: "11:00 AM", status: "completed", total_amount: 35, payment_method: "card", deposit_paid: true, notes: "" },
  { id: "apt-12", customer_id: "cl-6", barber_id: "barber-1", barber_name: "Marcus Johnson", service_id: "svc-4", service_name: "Full Service", client_name: "Ryan Foster", client_phone: "(506) 555-0206", date: "2026-05-19", time_slot: "2:00 PM", status: "completed", total_amount: 55, payment_method: "card", deposit_paid: true, notes: "" },
  { id: "apt-13", customer_id: "cl-9", barber_id: "barber-2", barber_name: "Tyler Smith", service_id: "svc-7", service_name: "Hot Towel Shave", client_name: "Kevin O'Brien", client_phone: "(506) 555-0209", date: "2026-05-18", time_slot: "3:30 PM", status: "cancelled", total_amount: 40, payment_method: "card", deposit_paid: false, notes: "Client cancelled 2hrs before" },
  { id: "apt-14", customer_id: "cl-13", barber_id: "barber-3", barber_name: "James Brown", service_id: "svc-1", service_name: "Haircut", client_name: "Liam Nguyen", client_phone: "(506) 555-0213", date: "2026-05-17", time_slot: "1:00 PM", status: "completed", total_amount: 30, payment_method: "cash", deposit_paid: false, notes: "" },
  // Future appointments
  { id: "apt-15", customer_id: "cl-12", barber_id: "barber-1", barber_name: "Marcus Johnson", service_id: "svc-2", service_name: "Skin Fade", client_name: "DaShawn King", client_phone: "(506) 555-0212", date: "2026-05-27", time_slot: "10:00 AM", status: "confirmed", total_amount: 35, payment_method: "card", deposit_paid: true, notes: "" },
  { id: "apt-16", customer_id: "cl-14", barber_id: "barber-2", barber_name: "Tyler Smith", service_id: "svc-4", service_name: "Full Service", client_name: "Ethan Brooks", client_phone: "(506) 555-0214", date: "2026-05-26", time_slot: "11:00 AM", status: "pending", total_amount: 55, payment_method: "card", deposit_paid: false, notes: "" },
  { id: "apt-17", customer_id: "cl-10", barber_id: "barber-3", barber_name: "James Brown", service_id: "svc-1", service_name: "Haircut", client_name: "Tony Diaz", client_phone: "(506) 555-0210", date: "2026-05-25", time_slot: "3:00 PM", status: "confirmed", total_amount: 30, payment_method: "cash", deposit_paid: false, notes: "" },
  { id: "apt-18", customer_id: "cl-2", barber_id: "barber-1", barber_name: "Marcus Johnson", service_id: "svc-3", service_name: "Beard Trim", client_name: "Alex Thompson", client_phone: "(506) 555-0202", date: "2026-05-28", time_slot: "9:30 AM", status: "confirmed", total_amount: 20, payment_method: "card", deposit_paid: false, notes: "" },
  { id: "apt-19", customer_id: "cl-5", barber_id: "barber-2", barber_name: "Tyler Smith", service_id: "svc-5", service_name: "Kids Cut", client_name: "Sam Patel", client_phone: "(506) 555-0205", date: "2026-05-26", time_slot: "4:30 PM", status: "pending", total_amount: 20, payment_method: "card", deposit_paid: false, notes: "" },
  { id: "apt-20", customer_id: "cl-8", barber_id: "barber-3", barber_name: "James Brown", service_id: "svc-4", service_name: "Full Service", client_name: "Jamal Harris", client_phone: "(506) 555-0208", date: "2026-05-25", time_slot: "1:30 PM", status: "confirmed", total_amount: 55, payment_method: "card", deposit_paid: true, notes: "Wants extra beard work" },
];

export const mockInventory = [
  { id: "inv-1", name: "Gold Label Pomade", category: "Styling", price: 28, cost_price: 12, quantity: 15, low_stock_threshold: 5 },
  { id: "inv-2", name: "Beard Oil (Cedar)", category: "Beard Care", price: 22, cost_price: 8, quantity: 3, low_stock_threshold: 5 },
  { id: "inv-3", name: "Fade Spray", category: "Styling", price: 18, cost_price: 6, quantity: 22, low_stock_threshold: 8 },
  { id: "inv-4", name: "Andis Clippers Blades", category: "Tools", price: 45, cost_price: 25, quantity: 2, low_stock_threshold: 3 },
  { id: "inv-5", name: "Shaving Cream Premium", category: "Shave", price: 20, cost_price: 7, quantity: 18, low_stock_threshold: 6 },
  { id: "inv-6", name: "AfterShave Balm", category: "Shave", price: 24, cost_price: 9, quantity: 11, low_stock_threshold: 5 },
  { id: "inv-7", name: "Hair Clay (Medium Hold)", category: "Styling", price: 25, cost_price: 10, quantity: 8, low_stock_threshold: 4 },
  { id: "inv-8", name: "Neck Strips (Pack of 100)", category: "Supplies", price: 12, cost_price: 4, quantity: 1, low_stock_threshold: 3 },
];

export const mockReviews = [
  { id: "rev-1", barber_id: "barber-1", barber_name: "Marcus Johnson", client_name: "Devon Williams", rating: 5, comment: "Marcus is an absolute legend. Best fade in Moncton, hands down. Won't go anywhere else.", created_at: "2026-05-20", replied: false },
  { id: "rev-2", barber_id: "barber-2", barber_name: "Tyler Smith", client_name: "Sam Patel", rating: 5, comment: "Tyler did an amazing job on my son's haircut. He made him feel so comfortable. Highly recommend!", created_at: "2026-05-19", replied: true },
  { id: "rev-3", barber_id: "barber-1", barber_name: "Marcus Johnson", client_name: "DaShawn King", rating: 5, comment: "Been coming here for 3 years. Marcus never misses. The shop is always clean and professional.", created_at: "2026-05-18", replied: false },
  { id: "rev-4", barber_id: "barber-3", barber_name: "James Brown", client_name: "Liam Nguyen", rating: 4, comment: "James did a solid job. Bit of a wait but worth it. The shop has a great vibe.", created_at: "2026-05-17", replied: false },
  { id: "rev-5", barber_id: "barber-2", barber_name: "Tyler Smith", client_name: "Jamal Harris", rating: 5, comment: "10/10 every time. Tyler really takes his time and listens to what you want. Bomb fade!", created_at: "2026-05-15", replied: true },
  { id: "rev-6", barber_id: "barber-1", barber_name: "Marcus Johnson", client_name: "Ryan Foster", rating: 5, comment: "Came for a full service — haircut AND beard. Marcus absolutely crushed it. Already booked next month.", created_at: "2026-05-14", replied: false },
  { id: "rev-7", barber_id: "barber-3", barber_name: "James Brown", client_name: "Ethan Brooks", rating: 3, comment: "Cut was decent but took longer than expected. Shop was a bit crowded. Will give it another shot.", created_at: "2026-05-10", replied: false },
  { id: "rev-8", barber_id: "barber-2", barber_name: "Tyler Smith", client_name: "Alex Thompson", rating: 4, comment: "Tyler's great with modern styles. Booked online super easily too — love the app!", created_at: "2026-05-08", replied: false },
];

export const mockPromoCodes = [
  { id: "promo-1", code: "WELCOME10", discount_type: "percent", discount_value: 10, uses_left: 45, total_uses: 55, expires_at: "2026-08-31", is_active: true },
  { id: "promo-2", code: "SUMMER20", discount_type: "percent", discount_value: 20, uses_left: 12, total_uses: 38, expires_at: "2026-07-31", is_active: true },
  { id: "promo-3", code: "BEARD5", discount_type: "fixed", discount_value: 5, uses_left: 0, total_uses: 20, expires_at: "2026-04-30", is_active: false },
];

export const mockNotifications = [
  { id: "n-1", title: "New Booking", message: "DaShawn King booked a Skin Fade with Marcus for today at 1:00 PM", type: "booking", is_read: false, created_at: "2026-05-24T08:30:00" },
  { id: "n-2", title: "No-Show Alert", message: "Chris Martinez did not show up for his 3:00 PM appointment", type: "no-show", is_read: false, created_at: "2026-05-24T15:10:00" },
  { id: "n-3", title: "New Review", message: "Devon Williams left a 5-star review for Marcus Johnson", type: "review", is_read: false, created_at: "2026-05-24T07:45:00" },
  { id: "n-4", title: "Low Inventory", message: "Beard Oil (Cedar) is running low — only 3 units left", type: "inventory", is_read: true, created_at: "2026-05-23T10:00:00" },
  { id: "n-5", title: "Booking Cancelled", message: "Kevin O'Brien cancelled his Hot Towel Shave for May 25", type: "cancellation", is_read: true, created_at: "2026-05-23T16:20:00" },
  { id: "n-6", title: "New Booking", message: "Marcus Webb booked a Skin Fade with Tyler Smith for today at 12:00 PM", type: "booking", is_read: true, created_at: "2026-05-24T06:15:00" },
  { id: "n-7", title: "Low Inventory", message: "Neck Strips are critically low — only 1 pack remaining", type: "inventory", is_read: false, created_at: "2026-05-24T09:00:00" },
  { id: "n-8", title: "New Review", message: "Jamal Harris left a 5-star review for Tyler Smith", type: "review", is_read: true, created_at: "2026-05-22T14:30:00" },
];

export const mockWaitlist = [
  { id: "wl-1", barber_id: "barber-1", barber_name: "Marcus Johnson", client_name: "Anonymous", client_phone: "(506) 555-9001", service_id: "svc-2", service_name: "Skin Fade", added_at: "2026-05-24T09:15:00", status: "waiting" },
  { id: "wl-2", barber_id: null, barber_name: "Any Barber", client_name: "Walk-in", client_phone: "(506) 555-9002", service_id: "svc-1", service_name: "Haircut", added_at: "2026-05-24T10:30:00", status: "waiting" },
];

// Revenue data for charts (last 30 days)
export const mockRevenueData = Array.from({ length: 30 }, (_, i) => {
  const date = new Date("2026-05-24");
  date.setDate(date.getDate() - (29 - i));
  const dayName = date.toLocaleDateString("en-CA", { weekday: "short" });
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const baseRevenue = isWeekend ? 400 : 280;
  const variance = Math.floor(Math.random() * 150) - 50;
  return {
    date: date.toISOString().split("T")[0],
    label: `${date.getMonth() + 1}/${date.getDate()}`,
    day: dayName,
    revenue: Math.max(150, baseRevenue + variance),
    appointments: Math.floor((baseRevenue + variance) / 32),
  };
});

export const mockHourlyRevenue = [
  { hour: "9 AM", revenue: 65, appointments: 2 },
  { hour: "10 AM", revenue: 110, appointments: 3 },
  { hour: "11 AM", revenue: 90, appointments: 3 },
  { hour: "12 PM", revenue: 35, appointments: 1 },
  { hour: "1 PM", revenue: 55, appointments: 2 },
  { hour: "2 PM", revenue: 55, appointments: 2 },
  { hour: "3 PM", revenue: 20, appointments: 1 },
  { hour: "4 PM", revenue: 15, appointments: 1 },
  { hour: "5 PM", revenue: 20, appointments: 1 },
];

export const mockRevenueByService = [
  { name: "Skin Fade", value: 1260, color: "#F5F0E6" },
  { name: "Full Service", value: 1100, color: "#FFFFFF" },
  { name: "Haircut", value: 780, color: "#D4CCB8" },
  { name: "Beard Trim", value: 420, color: "#B8AC8C" },
  { name: "Kids Cut", value: 240, color: "#928773" },
  { name: "Line Up", value: 180, color: "#6B6354" },
];

export const mockAppointmentStatuses = [
  { name: "Completed", value: 68, color: "#10B981" },
  { name: "Confirmed", value: 18, color: "#F5F0E6" },
  { name: "Pending", value: 8, color: "#F59E0B" },
  { name: "Cancelled", value: 4, color: "#EF4444" },
  { name: "No-Show", value: 2, color: "#F97316" },
];

export const mockStaffHours = [
  { id: "sh-1", barber_id: "barber-1", barber_name: "Marcus Johnson", date: "2026-05-24", clock_in: "8:55 AM", clock_out: null, hours_worked: null },
  { id: "sh-2", barber_id: "barber-2", barber_name: "Tyler Smith", date: "2026-05-24", clock_in: "9:02 AM", clock_out: null, hours_worked: null },
  { id: "sh-3", barber_id: "barber-3", barber_name: "James Brown", date: "2026-05-24", clock_in: "9:10 AM", clock_out: null, hours_worked: null },
  { id: "sh-4", barber_id: "barber-1", barber_name: "Marcus Johnson", date: "2026-05-23", clock_in: "9:00 AM", clock_out: "7:00 PM", hours_worked: 10 },
  { id: "sh-5", barber_id: "barber-2", barber_name: "Tyler Smith", date: "2026-05-23", clock_in: "9:05 AM", clock_out: "7:02 PM", hours_worked: 9.9 },
  { id: "sh-6", barber_id: "barber-3", barber_name: "James Brown", date: "2026-05-23", clock_in: "9:15 AM", clock_out: "6:58 PM", hours_worked: 9.7 },
];

export const mockTimeSlots = [
  "9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM",
  "12:00 PM", "12:30 PM", "1:00 PM", "1:30 PM", "2:00 PM", "2:30 PM",
  "3:00 PM", "3:30 PM", "4:00 PM", "4:30 PM", "5:00 PM", "5:30 PM",
];

export const mockTransactions = [
  { id: "tx-1", barber_id: "barber-2", barber_name: "Tyler Smith", client_name: "Jordan Lee", service_name: "Haircut", amount: 30, tip: 5, total: 35, payment_method: "card", type: "service", created_at: "2026-05-24T10:45:00" },
  { id: "tx-2", barber_id: "barber-1", barber_name: "Marcus Johnson", client_name: "Ryan Foster", service_name: "Full Service", amount: 55, tip: 10, total: 65, payment_method: "cash", type: "service", created_at: "2026-05-24T10:15:00" },
  { id: "tx-3", barber_id: "barber-1", barber_name: "Marcus Johnson", client_name: "Store", service_name: "Gold Label Pomade", amount: 28, tip: 0, total: 28, payment_method: "card", type: "product", created_at: "2026-05-24T09:30:00" },
];
