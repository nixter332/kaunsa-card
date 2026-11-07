import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import { evaluate, recommend, tieredUnits } from "../lib/engine";
import type { Card, Lookup } from "../lib/types";

const cards = cardsJson as Card[];
const card = (id: string) => cards.find((c) => c.id === id)!;
const lookup = (l: Partial<Lookup>): Lookup => ({ category: "other", amount: 1000, channel: "online", rail: "card", ...l });

describe("engine", () => {
  it("picks Flipkart Axis over HSBC on Myntra (Myntra is excluded from HSBC's 10%)", () => {
    const [best, ...rest] = recommend(cards, lookup({ merchant: "myntra", category: "apparel", amount: 2000 }));
    expect(best.cardId).toBe("flipkart-axis");
    expect(best.valueInr).toBe(150);
    const hsbc = rest.find((r) => r.cardId === "hsbc-live-plus")!;
    expect(hsbc.valueInr).toBe(30); // 1.5%
  });

  it("Swiggy HDFC gets 10% on Swiggy only at ₹249+", () => {
    expect(evaluate(card("swiggy-hdfc"), lookup({ merchant: "swiggy_food", category: "food_delivery", amount: 400 })).valueInr).toBe(40);
    const small = evaluate(card("swiggy-hdfc"), lookup({ merchant: "swiggy_food", category: "food_delivery", amount: 200 }));
    expect(small.valueInr).toBe(2); // falls back to 1% base
    expect(small.warnings.join(" ")).toMatch(/at least ₹249/);
  });

  it("HSBC wins dine-in until its cap is used up", () => {
    const dine = lookup({ merchant: "restaurant", category: "dining", channel: "offline", amount: 3000 });
    expect(recommend(cards, dine)[0].cardId).toBe("hsbc-live-plus");
    const capped = recommend(cards, dine, { "hsbc-live-plus": { capUsed: { ten: 1200 } } });
    expect(capped[0].cardId).not.toBe("hsbc-live-plus");
    expect(capped.find((r) => r.cardId === "hsbc-live-plus")!.warnings.join(" ")).toMatch(/used up/);
  });

  it("partial cap: earns only what's left", () => {
    const r = evaluate(card("hsbc-live-plus"), lookup({ category: "grocery", amount: 2000 }), { capUsed: { ten: 1100 } });
    expect(r.valueInr).toBe(100);
    expect(r.capConsumption.ten).toBe(100);
  });

  it("only RuPay cards are usable on UPI, and one of them is ranked first", () => {
    // Written to hold however many cards are in the app (it used to assume only Scapia RuPay existed).
    const res = recommend(cards, lookup({ category: "grocery", channel: "offline", rail: "upi", amount: 800 }));
    const usable = res.filter((r) => r.usable).map((r) => card(r.cardId));
    expect(usable.length).toBeGreaterThan(0);
    for (const c of usable) expect(c.upi && c.network === "RuPay", c.id).toBe(true);
    expect(res[0].usable).toBe(true);
    for (const r of res.filter((r) => !r.usable)) expect(card(r.cardId).upi, r.cardId).toBe(false);
  });

  it("Scapia RuPay earns nothing under ₹500", () => {
    const r = evaluate(card("scapia-rupay"), lookup({ rail: "upi", amount: 300 }));
    expect(r.valueInr).toBe(0);
    expect(r.usable).toBe(true);
  });

  it("Scapia coins are valued at ₹0.20", () => {
    expect(evaluate(card("scapia-visa"), lookup({ amount: 1000 })).valueInr).toBe(20); // 100 coins
  });

  it("rent is excluded on most cards", () => {
    const res = recommend(cards, lookup({ merchant: "rent", category: "rent", amount: 17500 }));
    expect(res.find((r) => r.cardId === "scapia-visa")!.valueInr).toBe(0);
  });

  it("tiered slabs are applied incrementally", () => {
    const tiers = card("indusind-tiger").base.tiers!;
    expect(tieredUnits(tiers, 0, 1000)).toBe(10);
    expect(tieredUnits(tiers, 99500, 1000)).toBe(5 + 10); // 500 @1% + 500 @2%
  });
});
