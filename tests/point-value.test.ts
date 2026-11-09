import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import type { Card } from "../lib/types";
import { normalizeCard, validateCard } from "../lib/validate";

const cards = cardsJson as Card[];
const card = (id: string) => structuredClone(cards.find((c) => c.id === id)!);

describe("what a point is worth", () => {
  it("every points card says what its ₹ value assumes", () => {
    for (const c of cards) {
      if (c.reward.kind === "cashback" && c.reward.inrPerUnit === 1) continue;
      expect(c.reward.valueBasis, c.id).toBeTruthy();
      expect(typeof c.reward.valueStated, c.id).toBe("boolean");
    }
  });

  it("a card whose point value is our estimate can't be high confidence", () => {
    const amex = card("amex-mrcc");
    expect(amex.reward.valueStated).toBe(false);
    expect(amex.confidence).not.toBe("high");
    expect(validateCard({ ...amex, confidence: "high" })).toContain("confidence can't be high when the point value is our estimate");
  });

  it("the agent's 'high' is lowered automatically when the value isn't stated", () => {
    const { card: fixed, changes } = normalizeCard({ ...card("amex-mrcc"), confidence: "high" as const });
    expect(fixed.confidence).toBe("medium");
    expect(changes.join(" ")).toMatch(/Confidence lowered/);
  });

  it("a points card without a value basis fails validation", () => {
    const regalia = card("hdfc-regalia-gold");
    delete regalia.reward.valueBasis;
    expect(validateCard(regalia).join(" ")).toMatch(/valueBasis/);
  });
});
