import { describe, expect, it } from "vitest";
import cards from "../data/cards.json";
import offers from "../data/offers.json";
import type { Card, Offer } from "../lib/types";
import { recommend } from "../lib/engine";
import { betterDeal } from "../lib/offers";

const all = cards as unknown as Card[];
const held = all.filter((c) => ["scapia-visa", "indusind-tiger", "hsbc-live-plus"].includes(c.id));
const ctx = { offers: offers as unknown as Offer[], today: new Date("2026-11-08T10:00:00+05:30") };
const goibibo = (amount: number) => ({ merchant: "goibibo", category: "travel", channel: "online", rail: "card", amount }) as never;

describe("better deal on EMI", () => {
  it("promotes Tiger's Goibibo EMI offer above a 2% card", () => {
    const deal = betterDeal(recommend(held, goibibo(12000), {}, ctx));
    expect(deal?.rec.cardId).toBe("indusind-tiger");
    expect(deal?.tip.discountInr).toBe(1800);
    expect(deal?.tip.short).not.toMatch(/IndusInd ×/);
  });
  it("stays quiet below the offer's minimum", () => {
    expect(betterDeal(recommend(held, goibibo(3000), {}, ctx))).toBeUndefined();
  });
});
