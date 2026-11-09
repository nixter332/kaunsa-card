// "Golden answers": a fixed set of lookups whose answers are saved in tests/golden.json.
// Any change to card data that changes an answer shows up as a before → after row,
// so a reviewer checks answers people would see, not JSON.
import { evaluate, recommend } from "./engine";
import { CATEGORIES, type Card, type Lookup, type Merchant } from "./types";

export type GoldenRow = { key: string; label: string; cardId: string; valueInr: number; rule: string };

/** Paise shown when there are any, so a change like ₹17.70 → ₹18 is visible. */
const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** The lookups we pin for one card: each bonus rule, the base rate, and a big spend that hits caps. */
function cardLookups(c: Card, merchants: Merchant[]): Lookup[] {
  const out: Lookup[] = [];
  for (const r of c.rules) {
    const rail = r.rails?.includes("upi") ? "upi" : "card";
    const m = merchants.find((x) => x.id === r.merchants?.[0]);
    const category = m?.category ?? r.categories?.[0] ?? "other";
    const channel = r.channels?.[0] ?? (rail === "upi" ? "offline" : (m?.channel ?? "online"));
    const base = { merchant: m?.id, category, channel, rail } as const;
    out.push({ ...base, amount: Math.max(1000, r.minTxn ?? 0) }, { ...base, amount: 50000 });
  }
  // Round amounts and small uneven ones (₹150, ₹1,180), where rounding and whole-₹ blocks show up.
  for (const amount of [150, 1000, 1180]) {
    out.push({ category: "other", amount, channel: "offline", rail: "card" });
    if (c.upi) out.push({ category: "other", amount, channel: "offline", rail: "upi" });
  }
  return out;
}

const keyOf = (cardId: string, l: Lookup) => `${cardId}|${l.merchant ?? l.category}|${l.amount}|${l.rail}|${l.channel}`;
const labelOf = (l: Lookup, merchants: Merchant[]) =>
  `${merchants.find((m) => m.id === l.merchant)?.name ?? l.category.replace(/_/g, " ")} ${rupees(l.amount)}${l.rail === "upi" ? " UPI" : ""}`;

/**
 * Every pinned answer: per card (with every condition met, e.g. Amazon Prime), plus which of all the
 * cards wins each spend type at ₹1,000, the closest thing to "what would most people see".
 */
export function goldenAnswers(cards: Card[], merchants: Merchant[]): GoldenRow[] {
  const rows = new Map<string, GoldenRow>();
  for (const c of cards) {
    const state = { capUsed: {}, conditions: [...new Set(c.rules.map((r) => r.requires).filter((x) => x !== undefined))] };
    for (const l of cardLookups(c, merchants)) {
      const r = evaluate(c, l, state);
      rows.set(keyOf(c.id, l), { key: keyOf(c.id, l), label: `${c.name}: ${labelOf(l, merchants)}`, cardId: c.id, valueInr: r.valueInr, rule: r.ruleLabel });
    }
  }
  for (const category of CATEGORIES) {
    for (const rail of ["card", "upi"] as const) {
      const l: Lookup = { category, amount: 1000, channel: rail === "upi" ? "offline" : "online", rail };
      const best = recommend(cards, l).find((r) => r.usable);
      if (!best) continue;
      const key = keyOf("ALL", l);
      rows.set(key, { key, label: `Best of all cards: ${labelOf(l, merchants)}`, cardId: best.cardId, valueInr: best.valueInr, rule: best.ruleLabel });
    }
  }
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export type GoldenChange = { key: string; label: string; before?: GoldenRow; after?: GoldenRow };

export function diffGolden(before: GoldenRow[], after: GoldenRow[]): GoldenChange[] {
  const old = new Map(before.map((r) => [r.key, r]));
  const now = new Map(after.map((r) => [r.key, r]));
  const changes: GoldenChange[] = [];
  for (const key of new Set([...old.keys(), ...now.keys()])) {
    const b = old.get(key);
    const a = now.get(key);
    if (b && a && b.cardId === a.cardId && Math.abs(b.valueInr - a.valueInr) < 0.01 && b.rule === a.rule) continue;
    changes.push({ key, label: (a ?? b)!.label, before: b, after: a });
  }
  return changes.sort((x, y) => x.key.localeCompare(y.key));
}

/** A markdown table for the monthly pull request. */
export function goldenTable(changes: GoldenChange[], cardName: (id: string) => string): string {
  if (!changes.length) return "No answer changed.";
  const cell = (r?: GoldenRow) => (r ? `${r.key.startsWith("ALL|") ? `${cardName(r.cardId)}, ` : ""}${rupees(r.valueInr)} (${r.rule})` : "(none)");
  return ["| Lookup | Before | After |", "| --- | --- | --- |", ...changes.map((c) => `| ${c.label} | ${cell(c.before)} | ${cell(c.after)} |`)].join("\n");
}
