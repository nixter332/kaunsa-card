import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import { localParse, parseAmount } from "../lib/localParse";
import type { Card } from "../lib/types";
import { diffCards, isConfirmedByDocument, validateCard } from "../lib/validate";

describe("local parser", () => {
  it("reads amounts in common formats", () => {
    expect(parseAmount("dinner 2,400")).toBe(2400);
    expect(parseAmount("myntra 1.5k")).toBe(1500);
    expect(parseAmount("₹650 zomato")).toBe(650);
  });
  it("prefers the longest merchant alias", () => {
    expect(localParse("swiggy dineout 3000")?.merchant).toBe("swiggy_dineout");
    expect(localParse("swiggy 450")?.merchant).toBe("swiggy_food");
  });
  it("detects UPI and treats it as offline", () => {
    expect(localParse("kirana 800 upi")).toMatchObject({ rail: "upi", channel: "offline", category: "grocery" });
  });
  it("returns null without an amount", () => {
    expect(localParse("zomato")).toBeNull();
  });
});

describe("card data", () => {
  it("every card in data/cards.json passes validation", () => {
    for (const c of cardsJson as Card[]) expect(validateCard(c), c.id).toEqual([]);
  });
  it("diff reports a rate change", () => {
    const old = (cardsJson as Card[]).find((c) => c.id === "flipkart-axis")!;
    const changed = { ...old, rules: old.rules.map((r) => (r.id === "myntra" ? { ...r, rate: 0.05 } : r)) };
    expect(diffCards(old, changed).join("\n")).toMatch(/Myntra.*7\.5% → 5%/);
  });
});

describe("agent review safeguards (from the first real run)", () => {
  const old = (cardsJson as Card[]).find((c) => c.id === "flipkart-axis")!;
  it("renamed rule and cap ids are not reported as remove + add", () => {
    const renamed: Card = {
      ...old,
      rules: old.rules.map((r) => ({ ...r, id: r.id + "-x", capId: r.capId && r.capId + "-cap" })),
      caps: old.caps.map((c) => ({ ...c, id: c.id + "-cap", label: c.label + " (cashback)" })),
    };
    expect(diffCards(old, renamed)).toEqual(["No changes to rates, caps or exclusions."]);
  });
  it("flags a network change and a dropped rule", () => {
    const changed: Card = { ...old, network: "Mastercard", rules: old.rules.filter((r) => r.id !== "preferred") };
    const d = diffCards(old, changed).join("\n");
    expect(d).toMatch(/network: Visa → Mastercard/);
    expect(d).toMatch(/- Rule "4% preferred merchant/);
  });
  it("rejects excluding 'other'", () => {
    const bad: Card = { ...old, exclusions: { ...old.exclusions, categories: [...old.exclusions.categories, "other"] } };
    expect(validateCard(bad).join(" ")).toMatch(/"other" can't be excluded/);
  });
});

describe("only stamp 'last checked' when the document confirms earn rates", () => {
  it("a fees-only document confirms nothing (the first IndusInd run)", () => {
    expect(isConfirmedByDocument(false, [])).toBe(false);
  });
  it("rules that were only kept from the old record don't count", () => {
    expect(isConfirmedByDocument(true, [{ evidence: "KEPT: not covered by document" }])).toBe(false);
  });
  it("a quoted rule, or a flat-rate card the document states, counts", () => {
    expect(isConfirmedByDocument(true, [{ evidence: "Myntra 7.5% INR 4000 per statement quarter" }])).toBe(true);
    expect(isConfirmedByDocument(true, [])).toBe(true);
  });
});
