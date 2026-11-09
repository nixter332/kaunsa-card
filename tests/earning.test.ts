import { describe, expect, it } from "vitest";
import { evaluate } from "../lib/engine";
import { quoteHasEarning } from "../lib/evidence";
import type { Card, Lookup } from "../lib/types";
import { validateCard } from "../lib/validate";

const ev = { quote: "q", source: "s", checked: "2026-11-09" };
const card = (earning?: NonNullable<Card["reward"]["earning"]>): Card => ({
  id: "t",
  name: "Test",
  issuer: "Bank",
  network: "RuPay",
  upi: true,
  reward: { kind: "cashback", unitName: "₹", inrPerUnit: 1, earning },
  base: { rate: 0.01 },
  rules: [{ id: "upi", label: "1.5% on UPI", rate: 0.015, rails: ["upi"] }],
  caps: [],
  exclusions: { categories: [], merchants: [] },
  notes: [],
  sources: [],
  lastVerified: "2026-11-09",
  confidence: "medium",
});
const pay = (amount: number, rail: Lookup["rail"] = "card"): Lookup => ({ category: "other", amount, channel: "offline", rail });

describe("how earning is counted", () => {
  it("smooth by default: ₹1,180 at 1% is ₹11.80", () => {
    expect(evaluate(card(), pay(1180)).valueInr).toBe(11.8);
  });
  it("rounded down per payment: ₹1,180 at 1% is ₹11 (Flipkart Axis's own example)", () => {
    expect(evaluate(card({ rounding: "down", evidence: ev }), pay(1180)).valueInr).toBe(11);
  });
  it("rounded to the nearest: ₹153 at 10% is ₹15, ₹156 is ₹16 (Swiggy HDFC's own example)", () => {
    const c = { ...card({ rounding: "nearest", evidence: ev }), base: { rate: 0.1 } };
    expect(evaluate(c, pay(153)).valueInr).toBe(15);
    expect(evaluate(c, pay(156)).valueInr).toBe(16);
    // HDFC's table: "650 ... 6.5 will be rounded down to 6" (at 1%).
    expect(evaluate({ ...c, base: { rate: 0.01 } }, pay(650)).valueInr).toBe(6);
  });
  it("whole ₹100s only: ₹150 earns like ₹100, and says so", () => {
    const r = evaluate(card({ block: 100, evidence: ev }), pay(150, "upi"));
    expect(r.valueInr).toBe(1.5);
    expect(r.warnings.join(" ")).toMatch(/whole ₹100s, so ₹100 of this payment counts/);
    expect(evaluate(card({ block: 100, evidence: ev }), pay(99, "upi")).valueInr).toBe(0);
    expect(evaluate(card({ block: 100, evidence: ev }), pay(300, "upi")).warnings).toEqual([]);
  });
});

describe("evidence for how earning is counted", () => {
  it("the quote must say it", () => {
    expect(quoteHasEarning("The cashback will be rounded down for each individual transaction.", { rounding: "down" })).toBe(true);
    expect(quoteHasEarning("The cashback will be rounded off to the nearest integer for each individual transaction.", { rounding: "nearest" })).toBe(true);
    expect(quoteHasEarning("The cashback will be rounded down for each individual transaction.", { rounding: "nearest" })).toBe(false);
    expect(quoteHasEarning("Kiwis will be awarded only on transaction amounts in multiples of Rs.100", { block: 100 })).toBe(true);
    expect(quoteHasEarning("Kiwis will be awarded only on transaction amounts in multiples of Rs.100", { block: 200 })).toBe(false);
  });
  it("the validator wants evidence and sane values", () => {
    expect(validateCard(card({ rounding: "down" })).join(" ")).toMatch(/needs evidence/);
    expect(validateCard(card({ block: 150.5, evidence: ev })).join(" ")).toMatch(/whole number/);
    expect(validateCard(card({ evidence: ev })).join(" ")).toMatch(/block or a rounding/);
    expect(validateCard(card({ block: 100, rounding: "down", evidence: ev }))).toEqual([]);
  });
});
