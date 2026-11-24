// @vitest-environment jsdom
// Guest mode: try the app before signing in. Guests read text on the device only (no Claude, no cost), are asked to
// sign in only where it adds something, and their events join their account in PostHog if they sign in later.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PostHog switched on (a test key) with a fake client, so we can see exactly what would be sent.
const ph = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
  return {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    get_distinct_id: vi.fn(() => "anon-device-id"),
    setPersonProperties: vi.fn(),
    reset: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  };
});
vi.mock("posthog-js", () => ({ default: ph }));
const actions = vi.hoisted(() => ({ signInWithGoogle: vi.fn(), signOutOfApp: vi.fn(), startGuest: vi.fn() }));
vi.mock("../app/actions", () => actions);
const server = vi.hoisted(() => ({ session: null as unknown, cookies: {} as Record<string, string> }));
vi.mock("@/auth", () => ({ auth: async () => server.session }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n in server.cookies ? { value: server.cookies[n] } : undefined) }) }));

import Page from "../app/page";
import { App } from "../app/ui/App";
import { Landing } from "../app/ui/SignIn";

const sent = (event: string) => ph.capture.mock.calls.filter((c) => c[0] === event);
const props = (event: string) => sent(event).map((c) => c[1] as Record<string, unknown>);
const ua = (s: string) => Object.defineProperty(window.navigator, "userAgent", { value: s, configurable: true });
const CHROME = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36";
const LINKEDIN = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [LinkedInApp]";

function ask(text: string) {
  const input = screen.getByLabelText(/describe the payment/i);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("cs.cards", JSON.stringify(["swiggy-hdfc", "hsbc-live-plus", "axis-ace"]));
  localStorage.setItem("cs.onboarded", "true");
  server.session = null;
  server.cookies = {};
  ua(CHROME);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("who sees what", () => {
  const rendered = async () => (await Page()) as ReactElement<{ user?: unknown }>;

  it("a first visit gets the landing screen", async () => {
    expect((await rendered()).type).toBe(Landing);
  });

  it("someone who tapped Try it now before goes straight into the app, as a guest", async () => {
    server.cookies = { kc_guest: "1" };
    const el = await rendered();
    expect(el.type).toBe(App);
    expect(el.props.user).toBeUndefined();
  });

  it("a signed-in person gets the app with their account", async () => {
    server.session = { user: { id: "g1", name: "A", email: "a@example.com" } };
    expect((await rendered()).props.user).toMatchObject({ id: "g1", email: "a@example.com" });
  });
});

describe("landing", () => {
  it("Try it now comes first; sign-in is the second option", () => {
    render(<Landing />);
    const buttons = screen.getAllByRole("button").map((b) => b.textContent?.trim());
    const tryAt = buttons.indexOf("Try it now");
    expect(tryAt).toBeGreaterThanOrEqual(0);
    expect(buttons.findIndex((b) => /sign in with google/i.test(b ?? ""))).toBeGreaterThan(tryAt);
    expect(screen.getByRole("button", { name: "Try it now" }).className).toMatch(/primary/);
  });

  it("Try it now starts a guest and records who shared the link", async () => {
    window.history.replaceState(null, "", "/?ref=abc123xy&utm_source=share");
    render(<Landing />);
    expect(props("signin_viewed")[0]).toMatchObject({ ref: "abc123xy", utm_source: "share" });
    fireEvent.click(screen.getByRole("button", { name: "Try it now" }));
    expect(props("guest_started")[0]).toMatchObject({ ref: "abc123xy", utm_source: "share" });
    await waitFor(() => expect(actions.startGuest).toHaveBeenCalled());
  });

  it("inside LinkedIn's browser there's no warning until Sign in is tapped, and then no trip to Google", async () => {
    ua(LINKEDIN);
    render(<Landing />);
    expect(screen.queryByText(/open this in/i)).toBeNull();
    expect(sent("inapp_browser_seen")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    expect(screen.getByText(/to sign in, open this in safari/i)).toBeTruthy();
    expect(props("inapp_browser_seen")[0]).toMatchObject({ app: "LinkedIn", source: "landing" });
    await new Promise((r) => setTimeout(r, 20));
    expect(actions.signInWithGoogle).not.toHaveBeenCalled();
    expect(sent("signin_clicked")).toHaveLength(0);
  });

  it("in a normal browser Sign in goes to Google", async () => {
    render(<Landing />);
    fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    expect(props("signin_clicked")[0]).toMatchObject({ source: "landing" });
    await waitFor(() => expect(actions.signInWithGoogle).toHaveBeenCalled());
  });
});

describe("guest lookups", () => {
  it("a known shop is answered on the device, with no Claude call and no prompt", () => {
    render(<App />);
    ask("swiggy 600");
    expect(fetch).not.toHaveBeenCalled();
    expect(props("lookup")[0]).toMatchObject({ parser: "instant", guest: true });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("an unknown shop is answered at everyday rates on the device, with one light prompt", () => {
    render(<App />);
    ask("Eatclub 456");
    expect(fetch).not.toHaveBeenCalled();
    expect(props("lookup")[0]).toMatchObject({ parser: "local", guest: true });
    expect(screen.getByText(/we didn't recognise that shop/i)).toBeTruthy();
    expect(props("signin_prompt_shown")).toEqual([{ reason: "unknown_shop" }]);
  });

  it("text the device can't read gets an error and the prompt, never a Claude call", () => {
    render(<App />);
    ask("something nice");
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/add a shop and an amount/i)).toBeTruthy();
    expect(screen.getByText(/we couldn't read that one/i)).toBeTruthy();
    expect(props("signin_prompt_shown")).toEqual([{ reason: "unreadable" }]);
    expect(sent("lookup")).toHaveLength(0);
  });

  it("the prompt is shown at most once per visit", () => {
    render(<App />);
    ask("something nice");
    ask("blah blah");
    ask("Eatclub 456");
    expect(sent("signin_prompt_shown")).toHaveLength(1);
  });

  it("Sign in from the prompt is counted, then goes to Google", async () => {
    render(<App />);
    ask("Eatclub 456");
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(props("signin_from_prompt")).toEqual([{ reason: "unknown_shop" }]);
    await waitFor(() => expect(actions.signInWithGoogle).toHaveBeenCalled());
  });

  it("Not now closes it", () => {
    render(<App />);
    ask("Eatclub 456");
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(screen.queryByText(/we didn't recognise that shop/i)).toBeNull();
  });

  it("a signed-in person still gets Claude, and never the prompt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ lookup: { category: "dining", amount: 456, channel: "online", rail: "card" }, parser: "claude" }), { status: 200 })),
    );
    render(<App user={{ id: "g1", name: "A", email: "a@example.com" }} />);
    ask("Eatclub 456");
    await waitFor(() => expect(props("lookup")[0]).toMatchObject({ parser: "claude", guest: false }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sent("signin_prompt_shown")).toHaveLength(0);
  });
});

describe("guests elsewhere in the app", () => {
  it("Settings offers sign-in instead of sign-out", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
  });

  it("the playbook and Advisor open without signing in", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /my cards/i }));
    expect(sent("playbook_viewed")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /advisor/i }));
    expect(screen.queryByText(/sign in/i)).toBeNull();
  });

  it("a guest's shared answer carries their share code", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<App />);
    ask("swiggy 600");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /share this answer/i })));
    const code = JSON.parse(localStorage.getItem("cs.shareCode")!) as string;
    expect(writeText.mock.calls[0][0]).toContain(`/?ref=${code}&utm_source=share`);
  });
});

describe("PostHog identity", () => {
  it("a guest stays anonymous: no identify, no person properties", () => {
    render(<App />);
    expect(ph.identify).not.toHaveBeenCalled();
    expect(ph.setPersonProperties).not.toHaveBeenCalled();
    expect(props("app_opened")[0]).toMatchObject({ guest: true });
  });

  it("signing in identifies the person from the device's anonymous ID, so earlier guest events join them", () => {
    render(<App user={{ id: "g1", name: "A", email: "a@example.com" }} />);
    expect(ph.get_distinct_id).toHaveBeenCalled();
    expect(ph.identify).toHaveBeenCalledWith("g1", { email: "a@example.com", name: "A" });
  });

  it("a guest referred by a link is counted as a referred sign-in once they sign in", () => {
    localStorage.setItem("cs.referredBy", JSON.stringify("abc123xy"));
    render(<App user={{ id: "g1", name: "A", email: "a@example.com" }} />);
    expect(props("referred_signin")).toEqual([{ ref: "abc123xy" }]);
  });
});
