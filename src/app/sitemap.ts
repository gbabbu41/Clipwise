import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/features", "/online-booking", "/payments", "/pricing", "/why-clipwise", "/shops", "/support", "/privacy", "/terms", "/cookies"].map(path => ({ url: `https://clipwise.ca${path}`, changeFrequency: "monthly", priority: path === "" ? 1 : 0.7 }));
}
