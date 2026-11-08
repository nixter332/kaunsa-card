// Card-terms change checker. Once a month we download every issuer page or PDF a card's rules came
// from and compare a fingerprint with last month's. Only cards whose documents changed are re-read
// by the rules agent, so a reward cut gets caught without re-extracting every card every month.
import crypto from "node:crypto";

/** Review and comparison sites: useful when adding a card, too noisy to watch. */
const SECONDARY_HOSTS =
  /(^|\.)(cardadvisor\.in|technofino\.in|cardinsider\.com|paisabazaar\.com|bankbazaar\.com|cardexpert\.in|livefromalounge\.com|groww\.in|bajajfinservmarkets\.in|finology\.in|savesage\.club|creditmantri\.com|reddit\.com|book1a\.com|finanjo\.com)$/i;

/** Issuer pages and PDFs on the web. Saved files on someone's laptop and review sites aren't watched. */
export function isWatchable(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    return !SECONDARY_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Page text with layout noise removed, so only wording changes count. */
export function watchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/©\s*\d{4}|copyright\s*\d{4}/g, "")
    .trim();
}

export const fingerprint = (data: Buffer | string) =>
  crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);

export type WatchEntry = {
  hash: string;
  firstSeen: string;
  lastChanged: string;
  lastChecked: string;
};
/** Keyed by URL. Saved in data/terms-watch.json. */
export type WatchState = Record<string, WatchEntry>;
export type FetchResult = { hash?: string; error?: string };

export function diffWatch(
  prev: WatchState,
  results: Record<string, FetchResult>,
  today: string,
) {
  const state: WatchState = { ...prev };
  const changed: string[] = [];
  const baselined: string[] = [];
  const unreachable: { url: string; error: string }[] = [];
  for (const [url, r] of Object.entries(results)) {
    if (!r.hash) {
      unreachable.push({ url, error: r.error ?? "unknown error" });
      continue;
    }
    const old = prev[url];
    if (!old) {
      state[url] = {
        hash: r.hash,
        firstSeen: today,
        lastChanged: today,
        lastChecked: today,
      };
      baselined.push(url);
    } else if (old.hash !== r.hash) {
      state[url] = {
        ...old,
        hash: r.hash,
        lastChanged: today,
        lastChecked: today,
      };
      changed.push(url);
    } else {
      state[url] = { ...old, lastChecked: today };
    }
  }
  return { state, changed, baselined, unreachable };
}

/** Cards that use any of the changed documents. */
export function cardsToRecheck(
  cards: { id: string; sources: { url: string }[] }[],
  changedUrls: string[],
): string[] {
  const set = new Set(changedUrls);
  return cards
    .filter((c) => c.sources.some((s) => set.has(s.url)))
    .map((c) => c.id);
}

/** Cards with no watchable source: a reward cut on these won't be noticed automatically. */
export function unwatchedCards(
  cards: { id: string; sources: { url: string }[] }[],
): string[] {
  return cards
    .filter((c) => !c.sources.some((s) => isWatchable(s.url)))
    .map((c) => c.id);
}
