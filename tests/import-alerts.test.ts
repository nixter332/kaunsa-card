import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import { htmlToLines, parseAlert } from "../lib/alerts";
import { importAlerts, type ImportedEntry, type Incoming } from "../lib/importAlerts";
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

describe("HTML emails keep their labels on separate lines", () => {
  it("reads the Axis email layout", () => {
    const html = `<table><tr><td>Transaction Amount:</td></tr><tr><td>INR 1553</td></tr><tr><td>Merchant Name:</td></tr><tr><td>PYU*AMAZON</td></tr>
      <tr><td>Axis Bank Credit Card No.</td></tr><tr><td>XX0574</td></tr><tr><td>Date &amp; Time:</td></tr><tr><td>22-10-2026, 11:30:27 IST</td></tr></table>
      <p>Here's the summary of your Axis Bank Credit Card Transaction</p>`;
    expect(parseAlert(htmlToLines(html))).toMatchObject({ issuer: "Axis Bank", last4: "0574", amount: 1553, merchant: { id: "amazon" } });
  });
});
