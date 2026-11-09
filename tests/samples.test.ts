import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import { recommend } from "../lib/engine";
import type { Card, Lookup } from "../lib/types";

// The sign-in screen shows these three payments with these three cards. If card data changes so they
// no longer have three different winners, pick new samples in app/ui/SignIn.tsx.
const cards = (cardsJson as Card[]).filter((c) => ["flipkart-axis", "swiggy-hdfc", "hsbc-live-plus"].includes(c.id));
const lookups: Lookup[] = [
  { merchant: "zomato", category: "food_delivery", amount: 600, channel: "online", rail: "card" },
  { merchant: "myntra", category: "apparel", amount: 3000, channel: "online", rail: "card" },
  { merchant: "amazon", category: "online_shopping", amount: 2000, channel: "online", rail: "card" },
];

describe("sign-in screen samples", () => {
  it("each sample has a clear winner, and it's a different card each time", () => {
    const winners = lookups.map((l) => {
      const [a, b] = recommend(cards, l);
      expect(a.valueInr, l.merchant).toBeGreaterThan(b.valueInr);
      return a.cardId;
    });
    expect(new Set(winners).size).toBe(3);
  });
});
