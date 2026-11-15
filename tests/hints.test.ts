import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import offersJson from "../data/offers.json";
import { merchantHints } from "../lib/engine";
import { MERCHANTS } from "../lib/localParse";
import type { Card, Lookup, Offer } from "../lib/types";

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

  it("'Movie 519' on a Saturday with HSBC Live+: the BookMyShow hint carries HSBC's buy-1-get-1 (owner's report, 14 Nov 2026)", () => {
    const ctx = { offers: offersJson as unknown as Offer[], today: new Date("2026-11-14T13:35:00+05:30") };
    const l = lookup({ category: "movies", channel: "offline", amount: 519 });
    const bms = merchantHints(pick("hsbc-live-plus", "scapia-visa"), l, {}, MERCHANTS, 4, ctx).find((h) => h.merchantId === "bookmyshow");
    expect(bms).toMatchObject({ cardId: "hsbc-live-plus", cardName: "HSBC Live+", offer: { discountInr: 250 } });
    expect(bms!.offer!.title).toMatch(/buy 1 get 1/i);
    // A Sunday: the offer doesn't apply, so the hint carries none.
    const sunday = merchantHints(pick("hsbc-live-plus"), l, {}, MERCHANTS, 4, { ...ctx, today: new Date("2026-11-15T13:35:00+05:30") });
    expect(sunday.find((h) => h.merchantId === "bookmyshow")?.offer).toBeUndefined();
  });
});
