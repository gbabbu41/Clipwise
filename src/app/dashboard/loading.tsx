export default function DashboardLoading() {
  return (
    <div className="p-6 space-y-6">
      <div className="h-8 w-48 animate-pulse bg-white/10 rounded-xl" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse bg-white/10 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 h-72 animate-pulse bg-white/10 rounded-xl" />
        <div className="h-72 animate-pulse bg-white/10 rounded-xl" />
      </div>
    </div>
  );
}
