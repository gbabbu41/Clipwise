// Shown during the server round-trip (the page is force-dynamic and gates on a
// DB read) so the customer sees a branded skeleton instead of a blank screen
// before the client's own skeleton mounts.
export default function Loading() {
  return (
    <div className="min-h-[100dvh] bg-black pt-[env(safe-area-inset-top)]">
      <div className="max-w-2xl mx-auto px-5 pt-6 pb-5 space-y-4">
        <div className="w-24 h-24 rounded-[26px] bg-[#141414] animate-pulse" />
        <div className="h-7 w-2/3 rounded-lg bg-[#141414] animate-pulse" />
        <div className="h-4 w-1/3 rounded bg-[#141414] animate-pulse" />
        <div className="h-11 w-full rounded-2xl bg-[#141414] animate-pulse mt-6" />
        <div className="space-y-2 mt-4">
          <div className="h-16 w-full rounded-2xl bg-[#141414] animate-pulse" />
          <div className="h-16 w-full rounded-2xl bg-[#141414] animate-pulse" />
        </div>
      </div>
    </div>
  );
}
