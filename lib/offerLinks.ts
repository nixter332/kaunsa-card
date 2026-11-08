// Finds the "Know More" links on an offers list page, so the offers agent can read each offer's own page.
import { MERCHANTS } from "./localParse";

export type OfferSource = {
  id: string;
  label: string;
  url: string;
  /** Follow links on this page whose address contains this text (e.g. "/offers/makemytrip-offers/"). */
  follow?: string;
  /** At most this many links (default 12). */
  maxLinks?: number;
  /** Only follow links that mention a shop the app knows (default true). */
  onlyKnownShops?: boolean;
};

const words = MERCHANTS.flatMap((m) => [m.id.replace(/_/g, " "), m.name, ...(m.aliases ?? [])])
  .map((w) => w.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim())
  .filter((w) => w.length >= 4);

/** Does this text (a link address or its label) name a shop the app knows? */
export function mentionsKnownShop(text: string): boolean {
  const t = text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const squashed = t.replace(/ /g, "");
  return words.some((w) => t.includes(w) || squashed.includes(w.replace(/ /g, "")));
}

/** Links on a page matching the follow pattern, same site only, de-duplicated, with their visible text. */
export function offerLinks(html: string, pageUrl: string, src: Pick<OfferSource, "follow" | "maxLinks" | "onlyKnownShops">): { url: string; text: string }[] {
  if (!src.follow) return [];
  const base = new URL(pageUrl);
  const found = new Map<string, string>();
  const re = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    let url: URL;
    try {
      url = new URL(m[1].replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    if (url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
    const href = url.toString().replace(/\/$/, "");
    if (!href.includes(src.follow) || href === pageUrl.replace(/\/$/, "")) continue;
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/&nbsp;|\s+/g, " ").trim();
    if (src.onlyKnownShops !== false && !mentionsKnownShop(`${href} ${text}`)) continue;
    if (!found.has(href) || (text && !found.get(href))) found.set(href, text);
  }
  return [...found].slice(0, src.maxLinks ?? 12).map(([url, text]) => ({ url, text }));
}
