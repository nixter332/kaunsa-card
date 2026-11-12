"use client";
// The client-side bits of the sign-in screen: analytics for the top of the funnel.
import { useEffect, useState } from "react";
import { rememberReferrer } from "./referral";
import { capture } from "@/lib/analytics";

/** signin_viewed, with the share code and source if they came from a shared link. */
export function SignInTracking() {
  useEffect(() => {
    const ref = rememberReferrer(window.location.search);
    const source = new URLSearchParams(window.location.search).get("utm_source") ?? undefined;
    capture("signin_viewed", { ref, utm_source: source });
  }, []);
  return null;
}

/** Apps whose built-in browser Google refuses to sign in from ("disallowed_useragent"). */
function inAppBrowser(ua: string): string | undefined {
  if (/LinkedInApp/i.test(ua)) return "LinkedIn";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "Facebook";
  if (/Twitter|Snapchat|Line\//i.test(ua)) return "this app";
  if (/Android.*; wv\)/i.test(ua)) return "this app";
  return undefined;
}

/** Inside an in-app browser: say so, and offer a way out to Chrome or Safari, before the Google button fails. */
export function InAppBrowserNote() {
  const [app, setApp] = useState<string>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const found = inAppBrowser(navigator.userAgent);
    if (found) {
      setApp(found);
      capture("inapp_browser_seen", { app: found });
    }
  }, []);
  if (!app) return null;
  const url = typeof window !== "undefined" ? window.location.href : "";
  const android = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
  return (
    <div className="inapp-note" role="note">
      <p>
        <strong>Open this in {android ? "Chrome" : "Safari"} to sign in.</strong> Google doesn&apos;t allow sign-in inside {app === "this app" ? "this app" : `${app}'s browser`}.
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

/** The Google button. signin_clicked goes out at once, before the page leaves for Google. */
export function SignInButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="btn google wide" onClick={() => capture("signin_clicked", {}, true)}>
      {children}
    </button>
  );
}
