import { describe, expect, it } from "vitest";
import { allowAiLookup, LIMITS } from "../lib/rateLimit";

describe("AI lookup limits (in-memory fallback)", () => {
  it("one person is cut off after their daily limit, and it resets the next day", async () => {
    const day1 = new Date("2026-11-07T06:00:00Z");
    for (let i = 0; i < LIMITS.PER_IP_LIMIT; i++) expect((await allowAiLookup("1.1.1.1", day1)).ok).toBe(true);
    expect(await allowAiLookup("1.1.1.1", day1)).toEqual({ ok: false, reason: "person" });
    expect((await allowAiLookup("2.2.2.2", day1)).ok).toBe(true); // someone else is fine
    expect((await allowAiLookup("1.1.1.1", new Date("2026-11-08T06:00:00Z"))).ok).toBe(true);
  });

  it("the overall daily limit applies across everyone", async () => {
    const day = new Date("2026-12-01T06:00:00Z");
    let allowed = 0;
    for (let i = 0; i < LIMITS.DAILY_LIMIT + 20; i++) if ((await allowAiLookup(`10.0.${Math.floor(i / 200)}.${i % 200}`, day)).ok) allowed++;
    expect(allowed).toBe(LIMITS.DAILY_LIMIT);
  });
});
