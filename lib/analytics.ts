// Anonymous product analytics via PostHog (free tier).
// Without NEXT_PUBLIC_POSTHOG_KEY nothing is sent anywhere; events are only kept on the device.
// No names, emails or bank details are ever sent: just which cards people picked and what they looked up.
import posthog from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
let started = false;

export const analyticsEnabled = Boolean(KEY);

function start() {
  if (started || !KEY || typeof window === "undefined") return;
  started = true;
  posthog.init(KEY, {
    api_host: HOST,
    person_profiles: "identified_only", // anonymous users only, no profiles
    autocapture: false, // only the events we send on purpose
    capture_pageview: true,
    disable_session_recording: true,
    persistence: "localStorage",
    debug: process.env.NEXT_PUBLIC_POSTHOG_DEBUG === "true",
  });
  try {
    if (localStorage.getItem("cs.statsOff") === "true") posthog.opt_out_capturing();
  } catch {}
}

export function capture(event: string, props: Record<string, unknown> = {}) {
  start();
  if (KEY) posthog.capture(event, props);
}

/** Lets people switch anonymous stats off in Settings. */
export function setStatsEnabled(on: boolean) {
  try {
    localStorage.setItem("cs.statsOff", String(!on));
  } catch {}
  start();
  if (!KEY) return;
  if (on) posthog.opt_in_capturing();
  else posthog.opt_out_capturing();
}

export function statsEnabled() {
  try {
    return localStorage.getItem("cs.statsOff") !== "true";
  } catch {
    return true;
  }
}

/** Rounded amount range, so lookups show spend patterns without exact figures. */
export function amountBucket(n: number) {
  if (n < 250) return "<250";
  if (n < 500) return "250-500";
  if (n < 1000) return "500-1k";
  if (n < 2500) return "1k-2.5k";
  if (n < 5000) return "2.5k-5k";
  if (n < 10000) return "5k-10k";
  if (n < 25000) return "10k-25k";
  return "25k+";
}
