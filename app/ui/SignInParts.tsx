"use client";
// Client-side sign-in pieces: landing analytics, "Try it now", the Google button (with the in-app browser warning,
// shown only when someone taps it), and the light sign-in prompt for guests.
import { useEffect, useState } from "react";
import { signInWithGoogle, startGuest } from "../actions";
import { rememberReferrer } from "./referral";
import { capture } from "@/lib/analytics";

/** signin_viewed (the landing screen; name kept so the funnel stays comparable), with the share code and source. */
export function LandingTracking() {
  useEffect(() => {
    const ref = rememberReferrer(window.location.search);
    const source = new URLSearchParams(window.location.search).get("utm_source") ?? undefined;
    capture("signin_viewed", { ref, utm_source: source, landing: "try_first" });
  }, []);
  return null;
}

/** Apps whose built-in browser Google refuses to sign in from ("disallowed_useragent"). */
export function inAppBrowser(ua: string): string | undefined {
  if (/LinkedInApp/i.test(ua)) return "LinkedIn";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "Facebook";
  if (/WhatsApp/i.test(ua)) return "WhatsApp";
  if (/Twitter|Snapchat|Line\//i.test(ua)) return "this app";
  if (/Android.*; wv\)/i.test(ua)) return "this app";
  return undefined;
}

/** After tapping Sign in inside an in-app browser: say why Google won't work here, and offer a way out. */
export function InAppBrowserNote({ app }: { app: string }) {
  const [copied, setCopied] = useState(false);
  const url = window.location.href;
  const android = /Android/i.test(navigator.userAgent);
  return (
    <div className="inapp-note" role="note">
      <p>
        <strong>To sign in, open this in {android ? "Chrome" : "Safari"}.</strong> Google doesn&apos;t allow sign-in inside{" "}
        {app === "this app" ? "this app" : `${app}'s browser`}. You can keep using Kaunsa Card here without signing in.
      </p>
      <div className="inapp-actions">
        {android && (
          <a
            className="btn ghost small"
            href={`intent://${url.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;end`}
            onClick={() => capture("inapp_open_browser", { app, method: "intent" }, true)}
          >
            Open in Chrome
          </a>
        )}
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            navigator.clipboard?.writeText(url).catch(() => {});
            setCopied(true);
            capture("inapp_open_browser", { app, method: "copy" });
          }}
        >
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>
      {!android && <p className="fine">Or tap the ⋯ or compass icon and choose &ldquo;Open in browser&rdquo;.</p>}
    </div>
  );
}

/**
 * The Google button, wherever it appears (landing, Settings, the prompt). Inside an in-app browser the tap shows
 * the note instead of sending the person to a Google page that will refuse them. signin_clicked goes out at once,
 * before the page leaves for Google.
 */
export function GoogleSignIn({ source, className = "btn google wide", onTap, children }: { source: string; className?: string; onTap?: () => void; children: React.ReactNode }) {
  const [blockedIn, setBlockedIn] = useState<string>();
  return (
    <>
      <form action={signInWithGoogle} className="signin-form">
        <button
          className={className}
          onClick={(e) => {
            onTap?.();
            const app = inAppBrowser(navigator.userAgent);
            if (app) {
              e.preventDefault();
              setBlockedIn(app);
              capture("inapp_browser_seen", { app, source });
              return;
            }
            capture("signin_clicked", { source }, true);
          }}
        >
          {children}
        </button>
      </form>
      {blockedIn && <InAppBrowserNote app={blockedIn} />}
    </>
  );
}

/** "Try it now": no Google, works in any browser. guest_started carries whose share link brought them, if any. */
export function TryItNow() {
  return (
    <form action={startGuest}>
      <button
        className="btn primary wide"
        onClick={() => {
          const ref = rememberReferrer(window.location.search);
          const source = new URLSearchParams(window.location.search).get("utm_source") ?? undefined;
          capture("guest_started", { ref, utm_source: source }, true);
        }}
      >
        Try it now
      </button>
    </form>
  );
}

export type PromptReason = "unreadable" | "unknown_shop";

/** The one light sign-in prompt, after a guest lookup the on-device reader couldn't fully understand. */
export function SignInPrompt({ reason, onTap, onDismiss }: { reason: PromptReason; onTap: () => void; onDismiss: () => void }) {
  return (
    <div className="signin-prompt" role="note">
      <p>
        <strong>{reason === "unknown_shop" ? "We didn't recognise that shop" : "We couldn't read that one"}</strong>
        {reason === "unknown_shop" ? ", so this shows each card's everyday rate. " : ". "}
        Sign in with Google and the app can read anything you type, like &ldquo;decathlon shoes 3k&rdquo;. Your cards stay on this phone.
      </p>
      <div className="signin-prompt-actions">
        <GoogleSignIn source="prompt" className="btn google small" onTap={onTap}>
          <GoogleG /> Sign in
        </GoogleSignIn>
        <button type="button" className="btn ghost small" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

export function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6.1C12.3 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
