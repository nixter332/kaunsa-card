// Runs every card through every kind of spend, so a data slip (0.25 for 0.025, a wrong unit value,
// a merchant id that doesn't exist) fails here instead of reaching a user.
import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import merchantsJson from "../data/merchants.json";
import offersJson from "../data/offers.json";
import { evaluate } from "../lib/engine";
import { CATEGORIES, type Card, type Lookup, type Merchant, type Offer } from "../lib/types";

const cards = cardsJson as Card[];
const merchants = merchantsJson as Merchant[];
const merchantIds = new Set(merchants.map((m) => m.id));
const card = (id: string) => cards.find((c) => c.id === id)!;

/** Highest believable value back on one payment. Airtel Axis gives 25% on Airtel bills. */
const MAX_PCT = 25;

function lookups(c: Card): Lookup[] {
  const out: Lookup[] = [];
  const named = [...new Set(c.rules.flatMap((r) => r.merchants ?? []))].map((id) => merchants.find((m) => m.id === id)!);
  for (const amount of [99, 450, 2400, 50000]) {
    for (const rail of c.upi ? (["card", "upi"] as const) : (["card"] as const)) {
      for (const channel of ["online", "offline"] as const) {
        for (const category of CATEGORIES) out.push({ category, amount, channel, rail });
        for (const m of named) out.push({ merchant: m.id, category: m.category, amount, channel, rail });
      }
    }
  }
  return out;
}

describe("every card, every kind of spend", () => {
  for (const c of cards) {
    it(`${c.id}: sane values`, () => {
      const allConditions = { capUsed: {}, conditions: [...new Set(c.rules.map((r) => r.requires).filter((x) => x !== undefined))] };
      for (const l of lookups(c)) {
        for (const state of [{ capUsed: {} }, allConditions]) {
          const r = evaluate(c, l, state);
          const where = `${c.id} ${l.merchant ?? l.category} ₹${l.amount} ${l.rail}/${l.channel}`;
          expect(Number.isFinite(r.valueInr), where).toBe(true);
          expect(r.valueInr, where).toBeGreaterThanOrEqual(0);
          expect(r.effectivePct, where).toBeLessThanOrEqual(MAX_PCT);
        }
      }
    });
  }

  it("the base-rate explanation states the real % (Kiwis are worth ₹0.25 each)", () => {
    for (const c of cards) {
      if (c.base.tiers) continue;
      const r = evaluate(c, { category: "other", amount: 2400, channel: "offline", rail: "card" });
      if (r.ruleLabel !== "Base rate" || r.warnings.length) continue;
      expect(r.reason, c.id).toContain(`${r.effectivePct}%`);
    }
    expect(evaluate(card("kiwi-rupay"), { category: "other", amount: 1000, channel: "online", rail: "card" }).reason).toMatch(/about 0\.5%/);
    expect(evaluate(card("swiggy-hdfc"), { category: "other", amount: 1000, channel: "offline", rail: "card" }).reason).toMatch(/the 1%\./);
  });

  it("every merchant id a card or offer uses exists in data/merchants.json", () => {
    for (const c of cards) {
      const ids = [...c.exclusions.merchants, ...c.rules.flatMap((r) => [...(r.merchants ?? []), ...(r.excludeMerchants ?? [])])];
      for (const id of ids) expect(merchantIds.has(id), `${c.id}: ${id}`).toBe(true);
    }
    for (const o of offersJson as Offer[]) for (const id of o.merchants) expect(merchantIds.has(id), `${o.id}: ${id}`).toBe(true);
  });

  it("a % offer with no maximum is a known, reviewed case", () => {
    // No cap is stated on these pages (SonyLIV checked against the Axis T&C, 9 Nov 2026: the plan price
    // is the only limit). Any new one needs a person to check the page first.
    const reviewed = new Set([
      "axis-sonyliv-20off-2026-11",
      "swiggy-blck-cleartrip-instant-discount",
      "swiggy-blck-nykaa-instant-discount",
      "swiggy-ornge-cleartrip-instant-discount",
      "swiggy-ornge-nykaa-instant-discount",
    ]);
    const uncapped = (offersJson as Offer[]).filter((o) => o.discount.type === "percent" && !o.discount.max).map((o) => o.id);
    for (const id of uncapped) expect(reviewed.has(id), id).toBe(true);
  });
});
