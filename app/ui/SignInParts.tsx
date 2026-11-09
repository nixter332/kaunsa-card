"use client";
// The client-side bits of the sign-in screen: analytics for the top of the funnel.
import { useEffect } from "react";
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

/** The Google button. signin_clicked goes out at once, before the page leaves for Google. */
export function SignInButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="btn google wide" onClick={() => capture("signin_clicked", {}, true)}>
      {children}
    </button>
  );
}
