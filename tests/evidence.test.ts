import { describe, expect, it } from "vitest";
import { checkQuote, normalizeText, quoteFound, quoteHasRate } from "../lib/evidence";

const cashback = { base: { rate: 0.01 }, reward: { kind: "cashback" as const, unitName: "₹", inrPerUnit: 1 } };
const points = { base: { rate: 0.025 }, reward: { kind: "points" as const, unitName: "RP", inrPerUnit: 0.5 } };

describe("evidence quotes", () => {
  const doc = `Cardholders will earn 7.5%
cashback on spends at Myntra, capped at Rs. 4,000 per statement
quarter. 5 Reward Points per ₹200 spent on all eligible “retail” spends.`;

  it("finds a quote despite line breaks, curly quotes and Rs./₹", () => {
    expect(quoteFound(doc, "earn 7.5% cashback on spends at Myntra")).toBe(true);
    expect(quoteFound(doc, "capped at ₹4000 per statement quarter")).toBe(true);
    expect(quoteFound(doc, '5 Reward Points per Rs 200 spent on all eligible "retail" spends')).toBe(true);
  });

  it("each piece of a quote with ... must be in the document", () => {
    expect(quoteFound(doc, "earn 7.5% cashback ... capped at Rs. 4,000 per statement quarter")).toBe(true);
    expect(quoteFound(doc, "earn 7.5% cashback ... capped at Rs. 5,000 per statement quarter")).toBe(false);
  });

  it("a made-up or reworded quote is not found", () => {
    expect(quoteFound(doc, "earn 10% cashback on spends at Myntra")).toBe(false);
    expect(quoteFound(doc, "Myntra")).toBe(false); // too short to prove anything
  });

  it("the quote must state the rule's rate", () => {
    expect(quoteHasRate("earn 7.5% cashback on Myntra", { rate: 0.075 }, cashback)).toBe(true);
    expect(quoteHasRate("earn 7.5% cashback on Myntra", { rate: 0.05 }, cashback)).toBe(false);
    expect(quoteHasRate("5 Reward Points per ₹200 spent", { rate: 0.025 }, points)).toBe(true);
    expect(quoteHasRate("10X Reward Points on dining", { rate: 0.25 }, points)).toBe(true);
    expect(quoteHasRate("10 Reward Points per ₹100", { rate: 0.1 }, points)).toBe(true);
    expect(quoteHasRate("Preferred merchants earn accelerated cashback", { rate: 0.04 }, cashback)).toBe(false);
  });

  it("reports which document holds the quote", () => {
    const r = checkQuote([{ source: "a.pdf", text: "nothing here" }, { source: "b.pdf", text: doc }], "earn 7.5% cashback on spends at Myntra", { rate: 0.075 }, cashback);
    expect(r).toEqual({ found: true, hasRate: true, source: "b.pdf" });
  });

  it("normalizes numbers and symbols", () => {
    expect(normalizeText("Rs. 1,500 (5 %).")).toBe("rs 1500 5%");
  });
});
