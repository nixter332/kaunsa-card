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
