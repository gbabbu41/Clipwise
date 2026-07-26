"use client";
import { useState } from "react";
import { Link2, Copy, Check, QrCode, Code, Share2, ExternalLink, AtSign, Smartphone } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-3">
      <span className="text-foreground">✓</span>{message}
      <button onClick={onClose} className="text-grey hover:text-foreground ml-2">✕</button>
    </div>
  );
}

export default function SharePage() {
  const { shop } = useAuth();
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  if (!shop) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-grey">No shop found. Set up your shop first.</p>
      </div>
    );
  }

  const BASE_URL = typeof window !== "undefined" ? window.location.origin : "https://clipwise.ca";
  const bookingUrl = `${BASE_URL}/book/${shop.slug}`;
  const profileUrl = `${BASE_URL}/shops/${shop.slug}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(bookingUrl)}&bgcolor=1C1C1E&color=C9A84C&margin=20`;

  const copy = async (text: string, label = "Copied!") => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    showToast(label);
    setTimeout(() => setCopied(false), 2000);
  };

  const embedCode = `<!-- ClipWise Booking Widget -->
<a href="${bookingUrl}" target="_blank" rel="noopener noreferrer"
  style="display:inline-block;background:#F5F0E6;color:#000;font-family:sans-serif;font-weight:700;font-size:15px;padding:12px 28px;border-radius:10px;text-decoration:none;">
  ✂️ Book Online
</a>`;

  const strategies = [
    {
      icon: AtSign,
      title: "Instagram Bio",
      desc: "Add your booking link to your Instagram bio. It's the #1 source of bookings.",
      action: "Copy link for bio",
      copy: bookingUrl,
    },
    {
      icon: Smartphone,
      title: "Text Your Clients",
      desc: "Send this link to your regulars via text or WhatsApp to let them book online.",
      action: "Copy link",
      copy: `Book your next cut at ${shop.name}: ${bookingUrl}`,
    },
    {
      icon: QrCode,
      title: "QR Code at Your Shop",
      desc: "Print the QR code below and display it at your shop. Clients scan it to book.",
      action: "Download QR Code",
      qr: true,
    },
    {
      icon: Code,
      title: "Embed on Your Website",
      desc: "Add a booking button to your website with this one-click embed code.",
      action: "Copy embed code",
      copy: embedCode,
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground uppercase tracking-wide">Share Your Booking Link</h1>
        <p className="text-sm text-grey mt-0.5">Get more clients by sharing your ClipWise booking page</p>
      </div>

      {/* Main booking URL */}
      <Card>
        <CardContent>
          <p className="text-xs text-grey mb-3 font-medium uppercase tracking-wider">Your Booking Link</p>
          <div className="flex items-center gap-3 bg-card-raised rounded-xl px-4 py-3 border border-border">
            <Link2 size={16} className="text-foreground flex-shrink-0" />
            <span className="text-foreground text-sm font-medium flex-1 truncate">{bookingUrl}</span>
            <button
              onClick={() => copy(bookingUrl)}
              className="flex items-center gap-1.5 text-xs text-foreground bg-black/10 hover:bg-gold/30 border border-black rounded-lg px-3 py-1.5 transition-colors"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <div className="flex gap-3 mt-3">
            <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
              <Button variant="outline" className="w-full" size="sm">
                <ExternalLink size={14} /> Preview Booking Page
              </Button>
            </a>
            <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
              <Button variant="ghost" className="w-full" size="sm">
                <ExternalLink size={14} /> View Shop Profile
              </Button>
            </a>
          </div>
        </CardContent>
      </Card>

      {/* QR Code + Strategies */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* QR Code */}
        <Card>
          <CardHeader>
            <QrCode size={18} className="text-foreground" />
            <CardTitle>QR Code</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-4">
              <div className="bg-card-raised border border-border rounded-2xl p-4">
                {/* QR code via free API */}
                <img
                  src={qrUrl}
                  alt="Booking QR Code"
                  width={200}
                  height={200}
                  className="rounded-xl"
                />
              </div>
              <p className="text-xs text-grey text-center">
                Point your phone camera at this code to open your booking page
              </p>
              <div className="flex gap-3 w-full">
                <a
                  href={qrUrl}
                  download={`${shop.slug}-qr.png`}
                  className="flex-1"
                >
                  <Button variant="outline" className="w-full" size="sm">
                    Download QR Code
                  </Button>
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1"
                  onClick={() => copy(bookingUrl)}
                >
                  <Copy size={14} /> Copy Link
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sharing strategies */}
        <div className="space-y-3">
          {strategies.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="bg-card shadow-sm border border-border rounded-2xl p-4 hover:border-black transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-black/10 border border-border flex items-center justify-center flex-shrink-0">
                    <Icon size={16} className="text-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{s.title}</p>
                    <p className="text-xs text-grey mt-0.5 leading-relaxed">{s.desc}</p>
                  </div>
                </div>
                <button
                  onClick={() => s.copy ? copy(s.copy, `${s.title} copied!`) : showToast("Right-click the QR code to save")}
                  className="mt-3 w-full text-xs font-medium text-foreground hover:text-foreground bg-black/5 hover:bg-black/10 border border-border rounded-lg py-1.5 transition-colors"
                >
                  {s.action}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Embed code */}
      <Card>
        <CardHeader>
          <Code size={18} className="text-foreground" />
          <CardTitle>Website Embed Code</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-grey mb-3">Paste this code into your website to add a "Book Online" button.</p>
          <div className="relative">
            <pre className="bg-card-raised border border-border rounded-xl p-4 text-xs text-grey overflow-x-auto whitespace-pre-wrap">
              {embedCode}
            </pre>
            <button
              onClick={() => copy(embedCode, "Embed code copied!")}
              className="absolute top-3 right-3 text-xs text-foreground bg-black/10 hover:bg-gold/30 border border-black rounded-lg px-2.5 py-1 transition-colors"
            >
              <Copy size={11} className="inline mr-1" />Copy
            </button>
          </div>

          {/* Preview */}
          <div className="mt-4 p-4 bg-card-raised border border-border rounded-xl">
            <p className="text-xs text-grey mb-3">Preview:</p>
            <a
              href={bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-block", background: "#F5F0E6", color: "#000", fontFamily: "sans-serif", fontWeight: 700, fontSize: 15, padding: "12px 28px", borderRadius: 10, textDecoration: "none" }}
            >
              ✂️ Book Online
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Tips */}
      <Card>
        <CardHeader>
          <Share2 size={18} className="text-foreground" />
          <CardTitle>Pro Tips for Getting More Bookings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { tip: "Add your booking link in your Instagram bio — this alone can bring 10+ new clients/month." },
              { tip: "Text your regulars directly: 'Hey, you can now book online! Click here: [link]'" },
              { tip: "Put the QR code on your business cards and at your station." },
              { tip: "Post a story on Instagram with your link once a week." },
              { tip: "Ask every happy client to leave a review — it shows up publicly on your profile." },
              { tip: "Enable loyalty points so clients have a reason to return and rebook." },
            ].map((item, i) => (
              <div key={i} className="flex gap-2.5 text-sm text-grey">
                <span className="text-foreground mt-0.5 flex-shrink-0">✓</span>
                <p>{item.tip}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
