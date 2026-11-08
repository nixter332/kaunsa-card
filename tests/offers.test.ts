import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import merchantsJson from "../data/merchants.json";
import offersJson from "../data/offers.json";
import catalogJson from "../data/catalog.json";
import { evaluate, recommend } from "../lib/engine";
import { checkOffer, istWeekday, normIssuer, offerDiscount, offersForCards, validateOffer } from "../lib/offers";
import type { Card, Lookup, Offer } from "../lib/types";

const cards = cardsJson as Card[];
const card = (id: string) => cards.find((c) => c.id === id)!;
const lookup = (l: Partial<Lookup>): Lookup => ({ category: "travel", amount: 12000, channel: "online", rail: "card", merchant: "goibibo", ...l });

// Shaped like IndusInd's real Goibibo EMI offer (June–Sept 2026 terms), moved to November for the tests.
const goibibo: Offer = {
  id: "indusind-goibibo-flights-test",
  title: "IndusInd × Goibibo flights",
  kind: "bank_offer",
  issuer: "IndusInd Bank",
  merchants: ["goibibo"],
  discount: { type: "percent", value: 0.1, max: 1500 },
  minTxn: 5000,
  validFrom: "2026-11-01",
  validTo: "2026-11-30",
  days: ["mon", "tue", "wed"],
  usesPerMonth: 1,
  code: "GOINDUSEMI",
  conditions: "Domestic flights, no-cost EMI only",
  source: "test",
  lastVerified: "2026-11-08",
};
const MONDAY = new Date("2026-11-09T06:00:00Z");
const SUNDAY = new Date("2026-11-08T06:00:00Z");
const DECEMBER = new Date("2026-12-07T06:00:00Z");

describe("offers", () => {
  it("dates and weekdays are India time", () => {
    expect(istWeekday(MONDAY)).toBe("mon");
    // 20:00 UTC Sunday is already Monday 01:30 in India
    expect(istWeekday(new Date("2026-11-08T20:00:00Z"))).toBe("mon");
  });

  it("issuer names match loosely", () => {
    expect(normIssuer("IndusInd Bank")).toBe(normIssuer("IndusInd"));
    expect(normIssuer("SBI Card")).toBe(normIssuer("SBI"));
  });

  it("percent discounts stop at the max; flat ones never exceed the bill", () => {
    expect(offerDiscount(goibibo, 12000)).toBe(1200);
    expect(offerDiscount(goibibo, 20000)).toBe(1500);
    expect(offerDiscount({ ...goibibo, discount: { type: "flat", value: 250 } }, 200)).toBe(200);
  });

  it("applies on a Monday, and the card earns rewards on the amount after the discount", () => {
    const [best] = recommend([card("indusind-tiger")], lookup({}), {}, { offers: [goibibo], today: MONDAY });
    expect(best.offer?.discountInr).toBe(1200);
    expect(best.offer?.code).toBe("GOINDUSEMI");
    // Rewards are on the ₹10,800 actually charged
    const onNet = evaluate(card("indusind-tiger"), lookup({ amount: 10800 })).valueInr;
    expect(best.valueInr).toBe(onNet);
    expect(best.totalInr).toBeCloseTo(1200 + onNet, 2);
  });

  it("an EMI-only offer is a tip, not the headline answer", () => {
    const emi = { ...goibibo, payment: "emi" as const };
    const [r] = recommend([card("indusind-tiger")], lookup({}), {}, { offers: [emi], today: MONDAY });
    expect(r.offer).toBeUndefined();
    expect(r.offerHints?.join(" ")).toMatch(/no-cost EMI/);
  });

  it("on the wrong day it doesn't apply, but says when it would", () => {
    const [r] = recommend([card("indusind-tiger")], lookup({}), {}, { offers: [goibibo], today: SUNDAY });
    expect(r.offer).toBeUndefined();
    expect(r.offerHints?.join(" ")).toMatch(/Mon, Tue, Wed/);
  });

  it("below the minimum, after it ends, at another site or on another bank's card: no offer", () => {
    expect(checkOffer(goibibo, card("indusind-tiger"), lookup({ amount: 3000 }), MONDAY).status).toBe("below_min");
    expect(checkOffer(goibibo, card("indusind-tiger"), lookup({}), DECEMBER).status).toBe("no");
    expect(checkOffer(goibibo, card("indusind-tiger"), lookup({ merchant: "makemytrip" }), MONDAY).status).toBe("no");
    expect(checkOffer(goibibo, card("swiggy-hdfc"), lookup({}), MONDAY).status).toBe("no");
  });

  it("once per card per month", () => {
    const uses = { "indusind-goibibo-flights-test|indusind-tiger": 1 };
    const [r] = recommend([card("indusind-tiger")], lookup({}), {}, { offers: [goibibo], today: MONDAY, uses });
    expect(r.offer).toBeUndefined();
    expect(r.offerHints?.join(" ")).toMatch(/already used/);
  });

  it("an offer can lift a card above one with better rewards", () => {
    const pair = [card("indusind-tiger"), card("scapia-visa")];
    const without = recommend(pair, lookup({}), {});
    const withOffer = recommend(pair, lookup({}), {}, { offers: [goibibo], today: MONDAY });
    expect(without[0].cardId).toBe("scapia-visa"); // 10% Scapia coins on travel
    expect(withOffer[0].totalInr).toBeGreaterThanOrEqual(withOffer[1].totalInr);
  });

  it("lists live offers for the cards you hold", () => {
    expect(offersForCards([goibibo], [card("indusind-tiger"), card("swiggy-hdfc")], MONDAY)[0].cards.map((c) => c.id)).toEqual(["indusind-tiger"]);
    expect(offersForCards([goibibo], [card("indusind-tiger")], DECEMBER)).toEqual([]);
  });

  it("every offer in data/offers.json is valid", () => {
    const ids = [...cards.map((c) => c.id), ...(catalogJson as { id: string }[]).map((c) => c.id)];
    const issuers = [...cards.map((c) => c.issuer), ...(catalogJson as { issuer: string }[]).map((c) => c.issuer)];
    const merchants = (merchantsJson as { id: string }[]).map((m) => m.id);
    expect(validateOffer(goibibo, ids, merchants, issuers)).toEqual([]);
    for (const o of offersJson as Offer[]) expect(validateOffer(o, ids, merchants, issuers), o.id).toEqual([]);
  });
});
