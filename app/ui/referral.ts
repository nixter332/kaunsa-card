// Share links carry a random code (?ref=abc123), so we can count how many people a share brings in.
// The code is made on the device and says nothing about the person; PostHog links it to their account.
// No import from ./store: this runs on the sign-in screen, which shouldn't load all the card data.

function load(key: string, fallback: string): string {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as string) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const CODE = /^[a-z0-9]{6,12}$/;

/** This person's share code, made once and kept on the device. */
export function myShareCode(): string {
  let code = load("cs.shareCode", "");
  if (!CODE.test(code)) {
    code = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join("");
    save("cs.shareCode", code);
  }
  return code;
}

/** On the sign-in screen: remember whose link brought this person here (the first one counts). */
export function rememberReferrer(search: string): string | undefined {
  const ref = new URLSearchParams(search).get("ref")?.toLowerCase();
  if (ref && CODE.test(ref) && !load("cs.referredBy", "")) save("cs.referredBy", ref);
  return load("cs.referredBy", "") || undefined;
}

export const shareLink = () => `${window.location.origin}/?ref=${myShareCode()}&utm_source=share`;
