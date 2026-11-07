import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import { merchantHints } from "../lib/engine";
import { MERCHANTS } from "../lib/localParse";
import type { Card, Lookup } from "../lib/types";

const cards = cardsJson as Card[];
const pick = (...ids: string[]) => cards.filter((c) => ids.includes(c.id));
const lookup = (l: Partial<Lookup>): Lookup => ({ category: "other", amount: 1000, channel: "online", rail: "card", ...l });

describe("merchant hints", () => {
  it("Food delivery with no shop: suggests Swiggy for a Swiggy HDFC holder", () => {
    const hints = merchantHints(pick("swiggy-hdfc"), lookup({ category: "food_delivery", amount: 600 }), {}, MERCHANTS);
    const swiggy = hints.find((h) => h.merchantId === "swiggy_food");
    expect(swiggy?.cardId).toBe("swiggy-hdfc");
    expect(swiggy!.valueInr).toBe(60); // 10% of 600
  });

  it("Shopping tile covers clothes: suggests Myntra for a Flipkart Axis holder", () => {
    const hints = merchantHints(pick("flipkart-axis"), lookup({ category: "online_shopping", amount: 3000 }), {}, MERCHANTS);
    expect(hints.map((h) => h.merchantId)).toContain("myntra");
  });

  it("no hints once a shop is chosen, for Scan & pay, or with no amount", () => {
    const c = pick("swiggy-hdfc");
    expect(merchantHints(c, lookup({ merchant: "zomato", category: "food_delivery" }), {}, MERCHANTS)).toEqual([]);
    expect(merchantHints(c, lookup({ category: "other", rail: "upi", channel: "offline" }), {}, MERCHANTS)).toEqual([]);
    expect(merchantHints(c, lookup({ category: "food_delivery", amount: 0 }), {}, MERCHANTS)).toEqual([]);
  });

  it("never suggests a shop that wouldn't beat the current answer", () => {
    const l = lookup({ category: "food_delivery", amount: 600 });
    for (const h of merchantHints(cards, l, {}, MERCHANTS)) expect(h.valueInr).toBeGreaterThan(0);
  });
});
