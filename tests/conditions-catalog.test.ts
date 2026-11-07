import { describe, expect, it } from "vitest";
import catalog from "../data/catalog.json";
import { evaluate } from "../lib/engine";
import { localParse } from "../lib/localParse";
import type { Card, Lookup } from "../lib/types";
import { diffCards, validateCard } from "../lib/validate";

// A synthetic card shaped like Amazon Pay ICICI + a Tata-Neu-style UPI rate, independent of real data.
const card: Card = {
  id: "test",
  name: "Test card",
  issuer: "Test",
  network: "RuPay",
  upi: true,
  reward: { kind: "cashback", unitName: "₹", inrPerUnit: 1 },
  base: { rate: 0.01 },
  rules: [
    { id: "amazon-prime", label: "5% on Amazon (Prime)", rate: 0.05, merchants: ["amazon"], requires: "amazon_prime" },
    { id: "amazon", label: "3% on Amazon", rate: 0.03, merchants: ["amazon"] },
    { id: "upi-any", label: "0.5% on UPI", rate: 0.005, rails: ["upi"] },
    { id: "upi-app", label: "1.5% on UPI via own app", rate: 0.015, rails: ["upi"], requires: "partner_upi_app" },
  ],
  caps: [],
  exclusions: { categories: [], merchants: [] },
  notes: [],
  sources: [],
  lastVerified: "2026-11-07",
  confidence: "high",
};
const lookup = (l: Partial<Lookup>): Lookup => ({ category: "other", amount: 1000, channel: "online", rail: "card", ...l });

describe("conditions and UPI-only rates", () => {
  it("Prime rate only applies when the user has Prime", () => {
    const amazon = lookup({ merchant: "amazon", category: "online_shopping" });
    expect(evaluate(card, amazon).valueInr).toBe(30);
    expect(evaluate(card, amazon, { capUsed: {}, conditions: ["amazon_prime"] }).valueInr).toBe(50);
  });
  it("UPI-only rules don't apply to card swipes, and the app condition upgrades the rate", () => {
    expect(evaluate(card, lookup({ amount: 1000 })).valueInr).toBe(10); // base 1% on card
    expect(evaluate(card, lookup({ rail: "upi", channel: "offline" })).valueInr).toBe(5);
    expect(evaluate(card, lookup({ rail: "upi", channel: "offline" }), { capUsed: {}, conditions: ["partner_upi_app"] }).valueInr).toBe(15);
  });
  it("validator: unknown condition and UPI rate on a non-UPI card are errors", () => {
    const bad = { ...card, upi: false, network: "Visa" as const, rules: [{ id: "x", label: "x", rate: 0.01, rails: ["upi" as const] }, { id: "y", label: "y", rate: 0.01, requires: "vip" as never }] };
    const errs = validateCard(bad).join(" | ");
    expect(errs).toMatch(/UPI rate on a card that can't be used on UPI/);
    expect(errs).toMatch(/unknown condition "vip"/);
  });
  it("a new card's diff lists every rule for review", () => {
    const d = diffCards(undefined, card).join("\n");
    expect(d).toMatch(/NEW CARD/);
    expect(d).toMatch(/\+ Rule "5% on Amazon \(Prime\)" at 5% \(needs amazon_prime\)/);
    expect(d).toMatch(/\+ Rule "1.5% on UPI via own app" at 1.5% \(on upi, needs partner_upi_app\)/);
  });
});

describe("catalog of cards to add", () => {
  it("every entry has sources, a unique id, and a consistent UPI flag", () => {
    const ids = new Set<string>();
    for (const c of catalog) {
      expect(c.sources.length, c.id).toBeGreaterThan(0);
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      if (c.upi) expect(c.network, c.id).toBe("RuPay");
    }
  });
});

describe("parser: bill payments inside Google Pay are card payments", () => {
  it("electricity bill via gpay → gpay_bill on card", () => {
    expect(localParse("electricity bill via gpay 1800")).toMatchObject({ merchant: "gpay_bill", rail: "card" });
  });
  it("plain 'gpay 500 at kirana' is still UPI", () => {
    expect(localParse("kirana 500 gpay")).toMatchObject({ rail: "upi" });
  });
});
