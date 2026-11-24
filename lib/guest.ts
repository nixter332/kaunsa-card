// Guest mode: "Try it now" on the landing screen sets this cookie, so the next visit goes straight into the app.
// It only says "this browser chose to try without signing in"; nothing about the person. Guests read typed text on
// the device only: /api/parse (Claude) stays sign-in only, so guest mode costs nothing.
export const GUEST_COOKIE = "kc_guest";
export const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // a year
