// Product analytics via PostHog (free tier). Signed-in users are identified by their Google name and email.
// Without NEXT_PUBLIC_POSTHOG_KEY nothing is sent anywhere; events are only kept on the device.
// No card numbers or bank details are ever sent: just who it is, which cards they picked and what they looked up
// (for typed lookups, the first 80 characters of what was typed, e.g. "zomato 650").
import posthog from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
// Sent via this site's own /kc-relay path (see next.config.mjs) so ad blockers don't drop events.
const RELAY = "/kc-relay";
const UI_HOST = HOST.includes("://us.") ? "https://us.posthog.com" : "https://eu.posthog.com";
let started = false;

export const analyticsEnabled = Boolean(KEY);

function start() {
  if (started || !KEY || typeof window === "undefined") return;
  started = true;
  posthog.init(KEY, {
    api_host: RELAY,
    ui_host: UI_HOST,
    person_profiles: "identified_only", // a profile per signed-in person
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

/** After Google sign-in: ties this device's events to the person, so you can see who's who in PostHog. */
export function identifyUser(user: { id: string; name: string; email: string }) {
  start();
  if (!KEY) return;
  if (posthog.get_distinct_id() !== user.id) posthog.identify(user.id, { email: user.email, name: user.name });
}

export function resetUser() {
  if (KEY && started) posthog.reset();
}

/** Lets people switch usage stats off in Settings. */
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
