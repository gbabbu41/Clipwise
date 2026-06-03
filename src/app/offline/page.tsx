'use client';

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
      <div className="text-center">
        <div className="text-6xl mb-6">✂️</div>
        <h1 className="text-2xl font-bold text-white mb-2">You're offline</h1>
        <p className="text-[#777] mb-8">Check your connection and try again.</p>
        <button
          onClick={() => window.location.reload()}
          className="bg-white text-black font-semibold px-6 py-3 rounded-lg hover:bg-[#FFFFFF] transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
