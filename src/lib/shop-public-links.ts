import type { Shop } from "./database.types";

export function publicWebsite(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw || /[\s\\]/.test(raw)) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && url.hostname.includes(".") ? url.href : null;
  } catch { return null; }
}

const platforms = [
  ["instagram", "Instagram", "instagram.com", ""],
  ["facebook", "Facebook", "facebook.com", ""],
  ["tiktok", "TikTok", "tiktok.com", "@"],
  ["youtube", "YouTube", "youtube.com", "@"],
] as const;

export function shopSocialLinks(shop: Pick<Shop, "instagram" | "facebook" | "tiktok" | "youtube" | "website">) {
  const links: { label: string; href: string }[] = [];
  for (const [key, label, host, prefix] of platforms) {
    const raw = shop[key]?.trim();
    if (!raw) continue;
    const handle = raw.replace(/^@/, "");
    const isHandle = /^[\w.-]+$/.test(handle) && !handle.endsWith(".com") && !handle.endsWith(".be");
    const href = publicWebsite(isHandle ? `${host}/${prefix}${handle}` : raw);
    if (!href) continue;
    const url = new URL(href);
    const allowed = url.hostname === host || url.hostname.endsWith(`.${host}`) || (key === "youtube" && url.hostname === "youtu.be");
    if (allowed && url.pathname !== "/") links.push({ label, href });
  }
  const website = publicWebsite(shop.website);
  if (website) links.push({ label: "Website", href: website });
  return links;
}

export function shopDirections(shop: Pick<Shop, "name" | "address" | "city" | "province" | "postal_code" | "google_place_id">): string | null {
  if (!shop.address?.trim() && !shop.city?.trim() && !shop.google_place_id?.trim()) return null;
  const params = new URLSearchParams({ api: "1", query: [shop.name, shop.address, shop.city, shop.province, shop.postal_code].map(v => v?.trim()).filter(Boolean).join(", ") });
  if (shop.google_place_id?.trim()) params.set("query_place_id", shop.google_place_id.trim());
  return `https://www.google.com/maps/search/?${params}`;
}

// Keep the mailbox separator literal; encode URI-reserved local-part characters.
export function shopEmailLink(value?: string | null): string | null {
  const email = value?.trim();
  if (!email || email.length > 254) return null;
  const match = /^([A-Za-z0-9!#$%&'*+\/=?^_`{|}~.-]+)@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+)$/.exec(email);
  if (!match || match[1].length > 64 || match[1].startsWith(".") || match[1].endsWith(".") || match[1].includes("..")) return null;
  return `mailto:${encodeURIComponent(match[1])}@${match[2]}`;
}
