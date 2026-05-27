import Link from "next/link";
import { Home, Scissors } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="flex items-center justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-[#C9A84C]/15 flex items-center justify-center">
            <Scissors className="w-8 h-8 text-[#C9A84C]" />
          </div>
        </div>
        <h1 className="text-8xl font-bold text-[#C9A84C] mb-2">404</h1>
        <h2 className="text-2xl font-semibold text-white mb-3">Page Not Found</h2>
        <p className="text-gray-400 mb-8">
          Looks like this page got a bad cut. The page you&apos;re looking for doesn&apos;t exist or was moved.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-[#C9A84C] hover:bg-[#b8963e] text-black font-semibold px-6 py-3 rounded-xl transition-colors"
          >
            <Home className="w-4 h-4" />
            Go Home
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
