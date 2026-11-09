// Rules whose cap depends on other spending carry a note that is shown with the answer.
import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import { evaluate } from "../lib/engine";
import type { Card } from "../lib/types";

const card = (id: string) => (cardsJson as Card[]).find((c) => c.id === id)!;

describe("caps the engine can't model are shown as a note", () => {
  it("Airtel bill on Airtel Axis says the cashback depends on other spend", () => {
    const r = evaluate(card("airtel-axis"), { merchant: "airtel_bill", category: "telecom", amount: 2000, channel: "online", rail: "card" });
    expect(r.warnings.join(" ")).toMatch(/2× the 1% cashback/);
  });
  it("super.money's 3% on UPI says it's capped", () => {
    const r = evaluate(
      card("axis-supermoney"),
      { category: "other", amount: 5000, channel: "offline", rail: "upi" },
      { capUsed: {}, conditions: ["partner_upi_app"] },
    );
    expect(r.ruleLabel).toMatch(/3%/);
    expect(r.warnings.join(" ")).toMatch(/Capped each statement cycle/);
  });
  it("the note only shows when its rule applies", () => {
    const r = evaluate(card("airtel-axis"), { category: "dining", amount: 2000, channel: "offline", rail: "card" });
    expect(r.warnings).toEqual([]);
  });
});
