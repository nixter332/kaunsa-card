// @vitest-environment jsdom
// Gmail sync is only for the accounts in GMAIL_SYNC_EMAILS. Everyone else must never reach Google's Gmail consent
// screen (unverified app warning, and a lifetime cap of 100 users for the whole Google project).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; name: string; email: string } } }));
vi.mock("@/auth", () => ({ auth: async () => session.current }));
vi.mock("../app/actions", () => ({ signOutOfApp: vi.fn(), signInWithGoogle: vi.fn() }));

import Page from "../app/page";
import { App } from "../app/ui/App";
import { gmailAllowed, gmailSyncEmails } from "../lib/gmailAccess";

const OWNER = "owner@example.com";
const USER = { id: "u1", name: "Friend", email: "friend@example.com" };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("cs.cards", JSON.stringify(["swiggy-hdfc", "hsbc-live-plus"]));
  localStorage.setItem("cs.onboarded", "true");
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubEnv("AUTH_GOOGLE_ID", "client-id.apps.googleusercontent.com");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.head.querySelectorAll("script").forEach((s) => s.remove());
});

describe("the allowlist", () => {
  it("reads a comma-separated list, ignoring case and spaces", () => {
    const list = ` ${OWNER.toUpperCase()} , second@example.com,,`;
    expect([...gmailSyncEmails(list)]).toEqual([OWNER, "second@example.com"]);
    expect(gmailAllowed("Owner@Example.com", list)).toBe(true);
    expect(gmailAllowed("second@example.com", list)).toBe(true);
    expect(gmailAllowed(USER.email, list)).toBe(false);
  });

  it("fails closed: no list means nobody, and no email is never allowed", () => {
    expect(gmailAllowed(OWNER, undefined)).toBe(false);
    expect(gmailAllowed(OWNER, "")).toBe(false);
    expect(gmailAllowed(undefined, OWNER)).toBe(false);
    expect(gmailAllowed("", OWNER)).toBe(false);
  });
});

describe("the server decides", () => {
  async function appProps(email: string, list?: string) {
    if (list !== undefined) vi.stubEnv("GMAIL_SYNC_EMAILS", list);
    session.current = { user: { id: "g1", name: "X", email } };
    return ((await Page()) as ReactElement<{ gmailClientId?: string }>).props;
  }

  it("passes the client ID only for an allowlisted account", async () => {
    expect((await appProps(OWNER, OWNER)).gmailClientId).toBe("client-id.apps.googleusercontent.com");
    expect((await appProps(USER.email, OWNER)).gmailClientId).toBeUndefined();
  });

  it("passes nothing when GMAIL_SYNC_EMAILS isn't set", async () => {
    vi.stubEnv("GMAIL_SYNC_EMAILS", undefined as unknown as string);
    expect((await appProps(OWNER)).gmailClientId).toBeUndefined();
  });
});

describe("on the phone", () => {
  const googleScripts = () => document.querySelectorAll('script[src*="accounts.google.com"]').length;

  it("someone not on the list sees nothing about Gmail, and Google's Gmail script never loads", () => {
    render(<App user={USER} />);
    expect(screen.queryByRole("region", { name: /payments from gmail/i })).toBeNull();
    expect(screen.queryByText(/gmail/i)).toBeNull();
    expect(googleScripts()).toBe(0);
  });

  it("the owner sees Connect Gmail", () => {
    render(<App user={{ ...USER, email: OWNER }} gmailClientId="client-id" />);
    expect(screen.getByRole("button", { name: /connect gmail/i })).toBeTruthy();
    expect(googleScripts()).toBe(1);
  });

  it("anyone already connected can still disconnect in Settings", () => {
    localStorage.setItem("cs.gmail", JSON.stringify({ connected: true, lastSync: Date.now() }));
    render(<App user={USER} />);
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.getByRole("button", { name: /disconnect gmail/i })).toBeTruthy();
    expect(googleScripts()).toBe(0);
  });
});
