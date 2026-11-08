import { describe, expect, it } from "vitest";
import cards from "../data/cards.json";
import type { Card } from "../lib/types";
import { recommend } from "../lib/engine";

const all = cards as unknown as Card[];
const lookup = { merchant: "goibibo", category: "travel", channel: "online", rail: "card", amount: 12000 } as never;

describe("app-only rates stay on their app", () => {
  it("Scapia's 20% on the Scapia app doesn't apply on Goibibo", () => {
    const scapia = all.filter((c) => c.id.startsWith("scapia"));
    for (const r of recommend(scapia, lookup, {})) expect(r.ruleLabel ?? "").not.toMatch(/scapia app/i);
  });
});

describe("HPCL fuel cashback is in rupees", () => {
  it("₹2,000 at HPCL earns ₹80 on the HPCL Super Saver", () => {
    const hpcl = all.filter((c) => c.id === "icici-hpcl-super-saver");
    const [r] = recommend(hpcl, { merchant: "hpcl", category: "fuel", channel: "offline", rail: "card", amount: 2000 } as never, {});
    expect(r.valueInr).toBe(80);
  });
});
