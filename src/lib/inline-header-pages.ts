// Owner-dashboard routes that render their own inline header (title + bell +
// profile) via <DashboardHeader>. On these routes the layout shrinks the mobile
// top band and the sidebar hides its floating bell/profile, so the top matches
// the dashboard home. To convert another page: add its route here AND swap its
// heading for <DashboardHeader title=… />.
export const INLINE_HEADER_PAGES = [
  "/dashboard",
  "/dashboard/schedule",
  "/dashboard/appointments",
  "/dashboard/clients",
  "/dashboard/payments",
];
