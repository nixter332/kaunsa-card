import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import merchantsJson from "../data/merchants.json";
import offersJson from "../data/offers.json";
import { recommend } from "../lib/engine";
import { bestByShop, bestBySpend, cardSheet, earnsMoreAt, PLAYBOOK_SPENDS } from "../lib/playbook";
import type { Card, Merchant, Offer } from "../lib/types";

const all = cardsJson as Card[];
const merchants = merchantsJson as Merchant[];
const pick = (...ids: string[]) => all.filter((c) => ids.includes(c.id));
const mine = pick("swiggy-hdfc", "flipkart-axis", "hsbc-live-plus", "tata-neu-infinity-hdfc");

describe("playbook", () => {
  it("every row is the engine's own answer for ₹1,000", () => {
    for (const row of bestBySpend(mine)) {
      const spend = PLAYBOOK_SPENDS.find((s) => s.key === row.key)!;
      const best = recommend(mine, { ...spend.lookup, amount: 1000 }).find((r) => r.usable);
      expect(row.pct, row.key).toBe(best && best.valueInr > 0 ? best.effectivePct : 0);
      if (row.cardId) expect(row.cardId, row.key).toBe(best!.cardId);
    }
  });

  it("names the right card for well-known cases", () => {
    const by = Object.fromEntries(bestBySpend(mine).map((r) => [r.key, r]));
    expect(by.dining).toMatchObject({ cardId: "hsbc-live-plus", pct: 10 });
    expect(by.fuel.pct).toBe(0); // fuel is excluded on all four
    expect(by.upi.cardId).toBe("tata-neu-infinity-hdfc"); // the only RuPay card here
  });

  it("lists shops where the answer differs from the general one", () => {
    const shops = Object.fromEntries(bestByShop(mine, merchants, 20).map((r) => [r.key, r]));
    expect(shops.myntra).toMatchObject({ cardId: "flipkart-axis", pct: 7.5 });
    // HSBC's 10% on shopping leaves out Flipkart, so the shop row differs from the general one.
    expect(shops.flipkart.pct).toBe(5);
    const neuAndFlipkart = Object.fromEntries(bestByShop(pick("flipkart-axis", "tata-neu-infinity-hdfc"), merchants, 20).map((r) => [r.key, r]));
    expect(neuAndFlipkart.tata_neu).toMatchObject({ cardId: "tata-neu-infinity-hdfc", pct: 5 });
  });

  it("a card's sheet shows its bonus rules, limits, tips and perks", () => {
    const neu = cardSheet(all.find((c) => c.id === "tata-neu-infinity-hdfc")!, offersJson as Offer[]);
    expect(neu.bestFor[0]).toMatchObject({ pct: 5 });
    expect(neu.tips[0].text).toMatch(/NeuPass/);
    expect(neu.earnsNothing).toContain("fuel");
    const swiggy = cardSheet(all.find((c) => c.id === "swiggy-hdfc")!);
    expect(swiggy.bestFor[0].detail).toMatch(/up to ₹1,500 a month/);
    expect(swiggy.watch.join(" ")).toMatch(/Can't be used on UPI/);
  });

  it("a base-rate answer can say where the card earns more", () => {
    expect(earnsMoreAt(all.find((c) => c.id === "tata-neu-infinity-hdfc")!)[0]).toMatch(/Tata Neu/);
    expect(earnsMoreAt(all.find((c) => c.id === "amex-mrcc")!)).toEqual([]);
  });

  it("every tip in the data carries a checked bank quote", () => {
    for (const c of all) for (const t of c.tips ?? []) expect(t.quote && t.source && /^\d{4}-\d{2}-\d{2}$/.test(t.checked), c.id).toBe(true);
  });
});
