import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import { htmlToLines, parseAlert } from "../lib/alerts";
import { importAlerts, needsKind, setShopKind, shopOf, type ImportedEntry, type Incoming } from "../lib/importAlerts";
import type { Card, CardState } from "../lib/types";

const cards = (cardsJson as Card[]).filter((c) => ["swiggy-hdfc", "flipkart-axis", "hsbc-live-plus"].includes(c.id));

// Same rules as the app's statesFromLedger, kept minimal: caps used in the same calendar month as `at`.
const states = (ledger: ImportedEntry[], at: number): Record<string, CardState> => {
  const month = (ts: number) => new Date(ts).toISOString().slice(0, 7);
  return Object.fromEntries(
    cards.map((c) => {
      const capUsed: Record<string, number> = {};
      for (const e of ledger.filter((x) => x.cardId === c.id && month(x.ts) === month(at)))
        for (const [k, v] of Object.entries(e.capConsumption)) capUsed[k] = (capUsed[k] ?? 0) + v;
      return [c.id, { capUsed }];
    }),
  );
};

const msg = (id: string, text: string): Incoming => ({ ...parseAlert(text)!, msgId: id, fallbackTs: Date.UTC(2026, 10, 15) });
const swiggy = msg("m1", "Spent Rs.312 On HDFC Bank Card 9016 At PTM*SWIGGY IN On 2026-11-08:12:04:19.Not You?");
const instamart = msg("m2", "Rs.330 spent on HDFC Bank Card x9016 at PYU*Instamart Grocery on 2026-11-15:11:50:41.Not U?");
const burger = msg("m3", "Your HSBC Credit Card xx3845 was used for a transaction of INR 1372.00 at JIMIS BURGER LLP on 13/11/26.");

describe("importing alerts as payments", () => {
  const run = (incoming: Incoming[], ledger: ImportedEntry[] = [], last4: Record<string, string> = {}, ignoredLast4: string[] = []) =>
    importAlerts({ incoming, ledger, cards, last4, ignoredLast4, states });

  it("logs each payment on the right card, with the engine's cashback, and learns the last 4 digits", () => {
    const r = run([instamart, swiggy, burger]);
    expect(r.added).toBe(3);
    expect(r.ledger.map((e) => e.cardId)).toEqual(["swiggy-hdfc", "hsbc-live-plus", "swiggy-hdfc"]); // oldest first
    const sw = r.ledger.find((e) => e.label === "Swiggy (food)")!;
    // Swiggy HDFC 10% on Swiggy (₹249+), rounded to the nearest rupee per payment as HDFC's terms say.
    expect(sw).toMatchObject({ amount: 312, earned: 31, source: "gmail" });
    expect(sw.capConsumption.swiggy10).toBeCloseTo(31.2);
    expect(r.ledger.find((e) => e.label === "Jimis Burger Llp")).toMatchObject({ earned: 20.58 }); // unknown shop: base 1.5%
    expect(r.learned).toEqual({ "swiggy-hdfc": "9016", "hsbc-live-plus": "3845" });
    expect(r.unknownMerchant).toBe(1);
  });

  it("a re-sync, or the same payment again, isn't logged twice", () => {
    const first = run([swiggy]);
    const again = run([swiggy, { ...swiggy, msgId: "m9" }], first.ledger);
    expect(again.added).toBe(0);
    expect(again.ledger).toHaveLength(1);
  });

  it("a payment already logged by hand isn't added again", () => {
    const manual: ImportedEntry = { ts: Date.UTC(2026, 10, 8, 7), cardId: "swiggy-hdfc", capConsumption: {}, amount: 312 };
    expect(run([swiggy], [manual]).added).toBe(0);
  });

  it("a card it can't work out is held back to ask about; a card marked 'not in the app' is skipped", () => {
    const sbi = msg("m4", "Rs.500 spent on HDFC Bank Card x1111 at ZOMATO on 2026-11-10:10:00:00.");
    const r = run([sbi], [], { "swiggy-hdfc": "9016" });
    expect(r.added).toBe(0);
    expect(r.unmatched).toMatchObject([{ issuer: "HDFC Bank", last4: "1111", amount: 500 }]);
    expect(run([sbi], [], { "swiggy-hdfc": "9016" }, ["1111"]).unmatched).toEqual([]);
  });
});

describe("shops the app doesn't know", () => {
  const run = (incoming: Incoming[], ledger: ImportedEntry[] = [], shopKinds = {}) =>
    importAlerts({ incoming, ledger, cards, last4: {}, ignoredLast4: [], states, shopKinds });

  it("an unknown shop counts at the base rate and waits to be named; a known one doesn't", () => {
    const r = run([burger, swiggy]);
    const b = r.ledger.find((e) => e.cardId === "hsbc-live-plus")!;
    expect(b).toMatchObject({ category: "other", shop: "JIMIS BURGER", earned: 20.58 });
    expect(needsKind(b)).toBe(true);
    expect(r.ledger.filter(needsKind)).toHaveLength(1); // Swiggy is a known shop
  });

  it("naming it 'eating out' values it again at HSBC Live+'s 10% dining rate and uses up that limit", () => {
    const r = run([burger]);
    const named = setShopKind({ ledger: r.ledger, shop: "JIMIS BURGER", kind: "dining", cards, states });
    expect(named.changed).toBe(1);
    expect(named.ledger[0]).toMatchObject({ category: "dining", channel: "offline", kindSet: true, earned: 137.2 });
    expect(Object.values(named.ledger[0].capConsumption)[0]).toBeCloseTo(137.2);
    expect(named.deltaInr).toBeCloseTo(137.2 - 20.58);
    expect(named.ledger.filter(needsKind)).toHaveLength(0);
  });

  it("the next payment at a named shop is valued right away", () => {
    const r = run([burger], [], { "JIMIS BURGER": "dining" });
    expect(r.ledger[0]).toMatchObject({ category: "dining", kindSet: true, earned: 137.2 });
    expect(r.unknownMerchant).toBe(0);
  });

  it("payments imported before shops were remembered are still asked about, by their label", () => {
    const old: ImportedEntry = { ts: Date.UTC(2026, 10, 13, 8), cardId: "hsbc-live-plus", capConsumption: {}, amount: 1372, earned: 20.58, label: "Jimis Burger Llp", source: "gmail" };
    const known: ImportedEntry = { ...old, label: "Swiggy (food)" };
    expect(shopOf(old)).toBe("JIMIS BURGER");
    expect(shopOf(known)).toBeUndefined();
    expect(setShopKind({ ledger: [old], shop: "JIMIS BURGER", kind: "dining", cards, states }).ledger[0].earned).toBe(137.2);
  });
});

describe("HTML emails keep their labels on separate lines", () => {
  it("reads the Axis email layout", () => {
    const html = `<table><tr><td>Transaction Amount:</td></tr><tr><td>INR 1553</td></tr><tr><td>Merchant Name:</td></tr><tr><td>PYU*AMAZON</td></tr>
      <tr><td>Axis Bank Credit Card No.</td></tr><tr><td>XX0574</td></tr><tr><td>Date &amp; Time:</td></tr><tr><td>22-10-2026, 11:30:27 IST</td></tr></table>
      <p>Here's the summary of your Axis Bank Credit Card Transaction</p>`;
    expect(parseAlert(htmlToLines(html))).toMatchObject({ issuer: "Axis Bank", last4: "0574", amount: 1553, merchant: { id: "amazon" } });
  });
});
