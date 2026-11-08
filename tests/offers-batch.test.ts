import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import sourcesJson from "../data/offer-sources.json";
import { recommend } from "../lib/engine";
import { findDuplicate, offerUsesFromLedger, offerYearKey } from "../lib/offers";
import type { Card, Lookup, Offer } from "../lib/types";

const cards = cardsJson as Card[];
const tiger = cards.find((c) => c.id === "indusind-tiger")!;
const base: Offer = {
  id: "indusind-goibibo-2026-11",
  title: "IndusInd × Goibibo",
  kind: "bank_offer",
  issuer: "IndusInd Bank",
  merchants: ["goibibo"],
  discount: { type: "percent", value: 0.1, max: 1500 },
  validFrom: "2026-11-01",
  validTo: "2026-11-30",
  source: "test",
  lastVerified: "2026-11-08",
};

describe("offer batch helpers", () => {
  it("spots the same offer published twice (bank page and merchant page)", () => {
    const fromMerchant = { ...base, id: "goibibo-indusind-flights-nov", issuer: "IndusInd", title: "Goibibo IndusInd flights" };
    expect(findDuplicate(fromMerchant, [base])?.id).toBe(base.id);
  });

  it("doesn't call different deals, shops, banks or months duplicates", () => {
    expect(findDuplicate({ ...base, id: "x", discount: { type: "percent", value: 0.12, max: 1500 } }, [base])).toBeUndefined();
    expect(findDuplicate({ ...base, id: "x", merchants: ["makemytrip"] }, [base])).toBeUndefined();
    expect(findDuplicate({ ...base, id: "x", issuer: "HDFC Bank" }, [base])).toBeUndefined();
    expect(findDuplicate({ ...base, id: "x", validFrom: "2026-12-01", validTo: "2026-12-31" }, [base])).toBeUndefined();
  });

  it("'one free ticket every 6 months' stops after 2 uses in a year", () => {
    const perk: Offer = { id: "tiger-bms", title: "BookMyShow free ticket", kind: "card_perk", cardIds: ["indusind-tiger"], merchants: ["bookmyshow"], discount: { type: "flat", value: 500 }, usesPerYear: 2, source: "t", lastVerified: "2026-11-08" };
    const l: Lookup = { merchant: "bookmyshow", category: "movies", amount: 800, channel: "online", rail: "card" };
    const today = new Date("2026-11-08T06:00:00Z");
    expect(recommend([tiger], l, {}, { offers: [perk], today, uses: { [offerYearKey("tiger-bms", "indusind-tiger")]: 1 } })[0].offer?.discountInr).toBe(500);
    const usedUp = recommend([tiger], l, {}, { offers: [perk], today, uses: { [offerYearKey("tiger-bms", "indusind-tiger")]: 2 } })[0];
    expect(usedUp.offer).toBeUndefined();
    expect(usedUp.offerHints?.join(" ")).toMatch(/this year/);
  });

  it("counts offer uses per month and per year from logged payments", () => {
    const at = (iso: string) => ({ ts: new Date(iso).getTime(), cardId: "indusind-tiger", offerId: "tiger-bms" });
    const uses = offerUsesFromLedger([at("2026-02-10T10:00:00Z"), at("2026-11-02T10:00:00Z"), at("2025-12-30T10:00:00Z")], new Date("2026-11-08T06:00:00Z"));
    expect(uses["tiger-bms|indusind-tiger"]).toBe(1);
    expect(uses["tiger-bms|indusind-tiger|year"]).toBe(2);
  });

  it("the offer source list is well formed", () => {
    const list = sourcesJson as { id: string; label: string; url: string }[];
    expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
    for (const s of list) {
      expect(s.id).toMatch(/^[a-z0-9-]+$/);
      expect(s.url).toMatch(/^https:\/\//);
    }
  });
});
