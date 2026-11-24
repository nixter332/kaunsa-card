// @vitest-environment jsdom
// One "lookup" event per answer the person asks for: not while typing, and not again for a repeated tap while
// the first one is still being read ("Eatclub 456" logged 4 lookups and 4 Claude calls in 2 seconds, 15 Nov).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/actions", () => ({ signOutOfApp: vi.fn(), signInWithGoogle: vi.fn() }));
import { App } from "../app/ui/App";

const USER = { id: "u1", name: "Test", email: "test@example.com" };
const lookups = () => (JSON.parse(localStorage.getItem("cs.events") ?? "[]") as { e: string }[]).filter((x) => x.e === "lookup").length;

/** A /api/parse reply we release by hand, so a second tap lands while the first is still being read. */
function pendingParse() {
  let release!: () => void;
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = () =>
          resolve(new Response(JSON.stringify({ lookup: { category: "dining", amount: 456, channel: "online", rail: "card" }, parser: "claude" }), { status: 200 }));
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, release: () => act(async () => release()) };
}

function typeSlowly(input: HTMLElement, text: string) {
  for (let i = 1; i <= text.length; i++) fireEvent.change(input, { target: { value: text.slice(0, i) } });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("cs.cards", JSON.stringify(["swiggy-hdfc", "hsbc-live-plus", "axis-ace"]));
  localStorage.setItem("cs.onboarded", "true");
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("lookup event", () => {
  it("typing shows the live answer without logging; submitting logs exactly one lookup", () => {
    render(<App user={USER} />);
    const input = screen.getByLabelText(/describe the payment/i);
    typeSlowly(input, "swiggy 600");
    // The live answer under the box is on screen, worked out on the device...
    expect(screen.getByText(/see why and compare/i)).toBeTruthy();
    // ...but nothing is logged until the person asks.
    expect(lookups()).toBe(0);
    fireEvent.submit(input.closest("form")!);
    expect(lookups()).toBe(1);
  });

  it("a second submit while Claude is still reading is ignored: one call, one lookup", async () => {
    const { fetchMock, release } = pendingParse();
    render(<App user={USER} />);
    const input = screen.getByLabelText(/describe the payment/i);
    typeSlowly(input, "Eatclub 456");
    fireEvent.submit(input.closest("form")!);
    fireEvent.submit(input.closest("form")!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await release();
    expect(lookups()).toBe(1);
  });

  it("tapping a Recent chip three times in the same moment reads it once", async () => {
    localStorage.setItem("cs.recent", JSON.stringify(["Eatclub 456"]));
    const { fetchMock, release } = pendingParse();
    render(<App user={USER} />);
    const chip = screen.getByRole("button", { name: "Eatclub 456" });
    // All three taps before React re-renders (the chip isn't disabled yet), as on a phone.
    act(() => {
      chip.click();
      chip.click();
      chip.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((chip as HTMLButtonElement).disabled).toBe(true);
    await release();
    expect(lookups()).toBe(1);
  });

  it("the next lookup after an answer is logged again", async () => {
    render(<App user={USER} />);
    let input = screen.getByLabelText(/describe the payment/i);
    typeSlowly(input, "swiggy 600");
    fireEvent.submit(input.closest("form")!);
    fireEvent.click(screen.getByRole("button", { name: /new payment/i }));
    input = screen.getByLabelText(/describe the payment/i);
    fireEvent.change(input, { target: { value: "zomato 650" } });
    fireEvent.submit(input.closest("form")!);
    expect(lookups()).toBe(2);
  });
});
