// Regression tests for issues found while reviewing the 14-card batch.
import { describe, expect, it } from "vitest";
import { evaluate } from "../lib/engine";
import type { Card, Lookup } from "../lib/types";
import { normalizeCard, validateCard } from "../lib/validate";

const base = (over: Partial<Card>): Card => ({
  id: "t", name: "T", issuer: "T", network: "Visa", upi: false,
  reward: { kind: "cashback", unitName: "₹", inrPerUnit: 1 },
  base: { rate: 0.01 }, rules: [], caps: [], exclusions: { categories: [], merchants: [] },
  notes: [], sources: [], lastVerified: "2026-11-07", confidence: "medium", ...over,
});
const lookup = (l: Partial<Lookup>): Lookup => ({ category: "other", amount: 1000, channel: "online", rail: "card", ...l });

describe("a merchant rule overrides a category exclusion (Airtel Axis, Axis ACE)", () => {
  const airtel = base({
    rules: [{ id: "airtel", label: "25% on Airtel bills", rate: 0.25, merchants: ["airtel_bill"] }],
    exclusions: { categories: ["telecom", "utilities"], merchants: [] },
  });
  it("Airtel bill via Airtel Thanks earns 25%", () => {
    expect(evaluate(airtel, lookup({ merchant: "airtel_bill", category: "telecom" })).valueInr).toBe(250);
  });
  it("another phone bill still earns nothing", () => {
    expect(evaluate(airtel, lookup({ merchant: "mobile_recharge", category: "telecom" })).valueInr).toBe(0);
  });
  it("if the named rule doesn't apply (e.g. paid by UPI-only rule mismatch), it stays excluded, not base rate", () => {
    const cardOnly = base({ ...airtel, rules: [{ ...airtel.rules[0], channels: ["offline"] }] });
    expect(evaluate(cardOnly, lookup({ merchant: "airtel_bill", category: "telecom" })).valueInr).toBe(0);
  });
});

describe("cards with UPI-specific rates (Tata Neu Plus)", () => {
  const tata = base({
    network: "RuPay", upi: true,
    rules: [
      { id: "grocery", label: "1% grocery", rate: 0.01, categories: ["grocery"] },
      { id: "upi", label: "0.25% UPI", rate: 0.0025, rails: ["upi"] },
      { id: "upi-app", label: "1% via Tata Neu UPI ID", rate: 0.01, rails: ["upi"], requires: "partner_upi_app" },
    ],
  });
  it("UPI grocery earns the UPI rate, not the card grocery rate", () => {
    expect(evaluate(tata, lookup({ category: "grocery", rail: "upi", channel: "offline" })).valueInr).toBe(2.5);
  });
  it("…unless paid via the card's own UPI ID", () => {
    expect(evaluate(tata, lookup({ category: "grocery", rail: "upi" }), { capUsed: {}, conditions: ["partner_upi_app"] }).valueInr).toBe(10);
  });
  it("card-swipe grocery still earns the grocery rule", () => {
    expect(evaluate(tata, lookup({ category: "grocery" })).valueInr).toBe(10);
  });
});

describe("proposal auto-fixes and validation", () => {
  it("SBI Cashback: an online-only rule is valid", () => {
    const sbi = base({ rules: [{ id: "online", label: "5% online", rate: 0.05, channels: ["online"] }] });
    expect(validateCard(sbi)).toEqual([]);
  });
  it("Swiggy Ornge: '1% on other spends' becomes the base rate with its cap; unused caps are dropped", () => {
    const ornge = base({
      rules: [{ id: "other-1", label: "1% on other spends", rate: 0.01, capId: "other-cap" }],
      caps: [
        { id: "other-cap", label: "1% cap", amount: 1000, period: "month", overflow: "none" },
        { id: "unused", label: "Aggregate cap", amount: 4000, period: "month", overflow: "none" },
      ],
    });
    const { card, changes } = normalizeCard(ornge);
    expect(card.rules).toEqual([]);
    expect(card.base.capId).toBe("other-cap");
    expect(card.caps.map((c) => c.id)).toEqual(["other-cap"]);
    expect(changes).toHaveLength(2);
    expect(validateCard(card)).toEqual([]);
  });
});
