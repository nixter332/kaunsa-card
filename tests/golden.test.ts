import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import merchantsJson from "../data/merchants.json";
import { diffGolden, goldenAnswers, goldenTable, type GoldenRow } from "../lib/golden";
import type { Card, Merchant } from "../lib/types";
import golden from "./golden.json";

const cards = cardsJson as Card[];

describe("golden answers", () => {
  it("today's card data gives the saved answers (if you changed data on purpose: npm run golden -- --update)", () => {
    const changes = diffGolden(golden as GoldenRow[], goldenAnswers(cards, merchantsJson as Merchant[]));
    expect(changes.length, "\n" + goldenTable(changes, (id) => id)).toBe(0);
  });

  it("covers every card", () => {
    const covered = new Set((golden as GoldenRow[]).map((r) => r.key.split("|")[0]));
    for (const c of cards) expect(covered.has(c.id), c.id).toBe(true);
  });

  it("a rate change shows as one before → after row", () => {
    const changed = cards.map((c) =>
      c.id === "flipkart-axis" ? { ...c, rules: c.rules.map((r) => (r.merchants?.includes("myntra") ? { ...r, rate: 0.05 } : r)) } : c,
    );
    const rows = diffGolden(golden as GoldenRow[], goldenAnswers(changed, merchantsJson as Merchant[]));
    const myntra = rows.filter((r) => r.key === "flipkart-axis|myntra|1000|card|online");
    expect(myntra).toHaveLength(1);
    expect(goldenTable(myntra, (id) => id)).toMatch(/₹75 .* \| ₹50 /);
  });
});
