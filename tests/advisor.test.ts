import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import profilesJson from "../data/card-profiles.json";
import { advise, DEFAULT_INPUT, route, score, validateProfile, type AdvisorInput } from "../lib/advisor";
import type { Card, CardProfile } from "../lib/types";

const cards = cardsJson as Card[];
const pick = (...ids: string[]) => cards.filter((c) => ids.includes(c.id));
const input = (x: Partial<AdvisorInput>): AdvisorInput => ({ ...DEFAULT_INPUT, ...x });

// Made-up fees for the tests only; real ones come from the card details agent.
const P = (id: string, x: Partial<CardProfile> = {}): CardProfile => ({ id, joiningFee: 0, annualFee: 0, sources: ["test"], lastVerified: "2026-11-08", ...x });
const profiles: CardProfile[] = [
  P("swiggy-hdfc", { joiningFee: 500, annualFee: 500, feeWaiverSpend: 200_000 }),
  P("flipkart-axis", { joiningFee: 500, annualFee: 500, feeWaiverSpend: 350_000 }),
  P("hsbc-live-plus", { joiningFee: 999, annualFee: 999, feeWaiverSpend: 200_000, lounge: { domestic: 4 } }),
  P("indusind-tiger"),
  P("scapia-visa"),
  P("scapia-rupay"),
];

describe("card advisor", () => {
  it("routes each spend to the best card you'd hold", () => {
    const rows = route(pick("swiggy-hdfc", "flipkart-axis"), input({ spends: { swiggy: 3000, myntra: 2000 } }));
    expect(rows.find((r) => r.bucketId === "swiggy")?.cardId).toBe("swiggy-hdfc");
    expect(rows.find((r) => r.bucketId === "myntra")?.cardId).toBe("flipkart-axis");
  });

  it("charges the annual fee unless your spend on that card waives it", () => {
    const low = score(pick("swiggy-hdfc"), profiles, input({ spends: { swiggy: 3000 } }));
    expect(low.perCard["swiggy-hdfc"].fee).toBe(500);
    const high = score(pick("swiggy-hdfc"), profiles, input({ spends: { swiggy: 20000 } }));
    expect(high.perCard["swiggy-hdfc"].waived).toBe(true);
    expect(high.perCard["swiggy-hdfc"].fee).toBe(0);
  });

  it("suggests a Swiggy card to a heavy Swiggy user who only has Flipkart Axis", () => {
    const a = advise(cards, ["flipkart-axis"], profiles, input({ spends: { swiggy: 6000, myntra: 2000 }, fees: "any" }));
    expect(a.outcomes.filter((o) => o.status === "add").map((o) => o.cardId)).toContain("swiggy-hdfc");
    expect(a.outcomes.find((o) => o.cardId === "flipkart-axis")?.status).toBe("keep");
    expect(a.best.net).toBeGreaterThan(a.current.net);
    expect(a.gain).toBe(a.best.net - a.current.net);
  });

  it("respects 'no new cards'", () => {
    const a = advise(cards, ["flipkart-axis"], profiles, input({ spends: { swiggy: 6000 }, newCards: 0 }));
    expect(a.outcomes.some((o) => o.status === "add")).toBe(false);
  });

  it("says to close a paid card you don't use, but keep a free one", () => {
    const paid = profiles.map((p) => (p.id === "hsbc-live-plus" ? { ...p, feeWaiverSpend: undefined } : p));
    const a = advise(cards, ["swiggy-hdfc", "hsbc-live-plus", "indusind-tiger"], paid, input({ spends: { swiggy: 5000 }, newCards: 0 }));
    expect(a.outcomes.find((o) => o.cardId === "hsbc-live-plus")?.status).toBe("drop");
    expect(a.outcomes.find((o) => o.cardId === "indusind-tiger")?.status).toBe("spare");
  });

  it("only suggests free cards when asked to", () => {
    const a = advise(cards, [], profiles, input({ spends: { swiggy: 4000, dining: 3000, other: 5000 }, fees: "free", newCards: 3 }));
    for (const o of a.outcomes.filter((x) => x.status === "add")) {
      expect(o.profile!.joiningFee).toBe(0);
      expect(o.year.fee).toBe(0);
    }
  });

  it("never suggests a card that's no longer issued", () => {
    const closed = profiles.map((p) => (p.id === "swiggy-hdfc" ? { ...p, notIssued: true } : p));
    const a = advise(cards, [], closed, input({ spends: { swiggy: 8000 }, fees: "any" }));
    expect(a.outcomes.some((o) => o.cardId === "swiggy-hdfc")).toBe(false);
    // but someone who already has it is still told to keep it
    const held = advise(cards, ["swiggy-hdfc"], closed, input({ spends: { swiggy: 8000 }, newCards: 0 }));
    expect(held.outcomes.find((o) => o.cardId === "swiggy-hdfc")?.status).toBe("keep");
  });

  it("skips cards above your income band", () => {
    const strict = profiles.map((p) => (p.id === "swiggy-hdfc" ? { ...p, minIncomeMonthly: 150_000 } : p));
    const a = advise(cards, [], strict, input({ spends: { swiggy: 6000 }, incomeBand: "25-50", fees: "any" }));
    expect(a.outcomes.some((o) => o.cardId === "swiggy-hdfc")).toBe(false);
  });

  it("each new card adds at least ₹500 a year", () => {
    const a = advise(cards, [], profiles, input({ spends: { swiggy: 300, other: 400 }, fees: "any", newCards: 3 }));
    for (const o of a.outcomes.filter((x) => x.status === "add")) expect(o.why).toMatch(/Adds about/);
    expect(a.best.cardIds.length).toBeLessThanOrEqual(3);
  });

  it("catches common data mistakes, and data/card-profiles.json is clean", () => {
    expect(validateProfile(P("x", { minIncomeMonthly: 600_000 * 12 }))).not.toEqual([]);
    expect(validateProfile(P("x", { feeWaiverSpend: 100000 }))).not.toEqual([]); // waiver on a free card
    for (const p of profilesJson as CardProfile[]) {
      expect(validateProfile(p), p.id).toEqual([]);
      expect(cards.some((c) => c.id === p.id), `${p.id} has no rules in cards.json`).toBe(true);
    }
  });
});
