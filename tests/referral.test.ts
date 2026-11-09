import { beforeEach, describe, expect, it } from "vitest";
import { myShareCode, rememberReferrer } from "../app/ui/referral";

// A stand-in for the browser's localStorage.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
});

describe("share codes", () => {
  beforeEach(() => store.clear());

  it("makes one random code per device and keeps it", () => {
    const code = myShareCode();
    expect(code).toMatch(/^[a-z0-9]{8}$/);
    expect(myShareCode()).toBe(code);
  });

  it("remembers the first link someone arrived from", () => {
    expect(rememberReferrer("?ref=abc123&utm_source=share")).toBe("abc123");
    expect(rememberReferrer("?ref=zzz999")).toBe("abc123");
  });

  it("ignores codes that don't look like ours", () => {
    expect(rememberReferrer("?ref=<script>")).toBeUndefined();
    expect(rememberReferrer("?ref=nikhil@gmail.com")).toBeUndefined();
    expect(rememberReferrer("")).toBeUndefined();
  });
});
