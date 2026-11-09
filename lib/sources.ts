// Which sources are the bank's own. Shared by the terms watch, the evidence check and the app.

/** Review and comparison sites: useful when adding a card, too noisy to watch, never evidence. */
export const SECONDARY_HOSTS =
  /(^|\.)(cardadvisor\.in|technofino\.in|cardinsider\.com|paisabazaar\.com|bankbazaar\.com|cardexpert\.in|livefromalounge\.com|groww\.in|bajajfinservmarkets\.in|finology\.in|savesage\.club|creditmantri\.com|reddit\.com|book1a\.com|finanjo\.com)$/i;

/** Issuer pages and PDFs on the web. Saved files on someone's laptop and review sites don't count. */
export function isWatchable(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    return !SECONDARY_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
