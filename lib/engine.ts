// Deterministic rules engine. No AI here: every number comes from data/cards.json.
import type { Card, CardState, Lookup, Recommendation, Rule, Tier } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => `₹${round2(n).toLocaleString("en-IN")}`;

/** Points earned on `amount` when the card has spend-based slabs. */
export function tieredUnits(tiers: Tier[], alreadySpent: number, amount: number): number {
  let units = 0;
  let cursor = alreadySpent;
  let left = amount;
  let floor = 0;
  for (const tier of tiers) {
    const ceiling = tier.upTo ?? Infinity;
    if (cursor < ceiling && left > 0) {
      const start = Math.max(cursor, floor);
      const inSlab = Math.min(left, ceiling - start);
      units += inSlab * tier.rate;
      left -= inSlab;
      cursor += inSlab;
    }
    floor = ceiling;
  }
  return units;
}

function ruleMatches(rule: Rule, lookup: Lookup, state: CardState): boolean {
  if (rule.channels && !rule.channels.includes(lookup.channel)) return false;
  if (rule.rails && !rule.rails.includes(lookup.rail)) return false;
  if (rule.requires && !state.conditions?.includes(rule.requires)) return false;
  const m = lookup.merchant;
  if (m && rule.excludeMerchants?.includes(m)) return false;
  // A rule with no merchants or categories applies to everything (e.g. "1.5% on all UPI spends").
  if (!rule.merchants?.length && !rule.categories?.length) return true;
  if (m && rule.merchants?.includes(m)) return true;
  if (rule.categories?.includes(lookup.category)) return true;
  return false;
}

export function evaluate(card: Card, lookup: Lookup, state: CardState = { capUsed: {} }): Recommendation {
  const warnings: string[] = [];
  const capConsumption: Record<string, number> = {};
  const result = (partial: Partial<Recommendation>): Recommendation => {
    const units = round2(partial.rewardUnits ?? 0);
    const value = round2(units * card.reward.inrPerUnit);
    return {
      cardId: card.id,
      cardName: card.name,
      usable: partial.usable ?? true,
      rewardUnits: units,
      valueInr: value,
      effectivePct: lookup.amount > 0 ? round2((value / lookup.amount) * 100) : 0,
      ruleLabel: partial.ruleLabel ?? "",
      reason: partial.reason ?? "",
      warnings,
      capConsumption,
      confidence: card.confidence,
      lastVerified: card.lastVerified,
    };
  };

  // 1. Can this card be used this way at all?
  if (lookup.rail === "upi" && !card.upi) {
    return result({ usable: false, ruleLabel: "Not usable", reason: `${card.network} cards can't be linked to UPI.` });
  }

  // 2. Exclusions and minimums mean "you can pay, but you earn nothing".
  //    A category exclusion can be overridden by a rule that names this exact merchant
  //    (e.g. "bills earn nothing, except 25% on Airtel bills via Airtel Thanks").
  const m = lookup.merchant;
  const excludedMsg = `No rewards: ${lookup.category.replace("_", " ")} is excluded on this card.`;
  if (m && card.exclusions.merchants.includes(m)) {
    warnings.push(excludedMsg);
    return result({ ruleLabel: "Excluded", reason: "Excluded merchant" });
  }
  const categoryExcluded = card.exclusions.categories.includes(lookup.category);
  const namedMerchantRules = m ? card.rules.filter((r) => r.merchants?.includes(m)) : [];
  if (categoryExcluded && namedMerchantRules.length === 0) {
    warnings.push(excludedMsg);
    return result({ ruleLabel: "Excluded", reason: "Excluded category" });
  }
  if (card.minTxn && lookup.amount < card.minTxn) {
    warnings.push(`Earns nothing on spends under ${inr(card.minTxn)}.`);
    return result({ ruleLabel: "Below minimum", reason: `Minimum spend is ${inr(card.minTxn)}` });
  }

  const capOf = (id?: string) => card.caps.find((c) => c.id === id);
  const remaining = (id: string) => {
    const cap = capOf(id)!;
    return Math.max(0, cap.amount - (state.capUsed[id] ?? 0) - (capConsumption[id] ?? 0));
  };

  // Base-rate earning, respecting the base cap and spend slabs.
  const baseUnits = (spend: number): number => {
    if (spend <= 0) return 0;
    const raw = card.base.tiers ? tieredUnits(card.base.tiers, state.annualSpend ?? 0, spend) : spend * card.base.rate;
    const capId = card.base.capId;
    if (!capId) return raw;
    const earned = Math.min(raw, remaining(capId));
    capConsumption[capId] = (capConsumption[capId] ?? 0) + earned;
    if (earned < raw) warnings.push(`${capOf(capId)!.label} reached: part of this spend earns nothing.`);
    return earned;
  };

  // 3. Best matching accelerated rule.
  //    If the card has UPI-specific rates, UPI payments only earn through those (not the card-swipe rules).
  const hasUpiRules = card.rules.some((r) => r.rails?.includes("upi"));
  const pool = (categoryExcluded ? namedMerchantRules : card.rules).filter((r) => !(lookup.rail === "upi" && hasUpiRules && !r.rails));
  const candidates = pool.filter((r) => ruleMatches(r, lookup, state));
  const eligibleRules = candidates.filter((r) => !r.minTxn || lookup.amount >= r.minTxn);
  for (const r of candidates) {
    if (r.minTxn && lookup.amount < r.minTxn) warnings.push(`Spend at least ${inr(r.minTxn)} to get "${r.label}".`);
  }
  const rule = eligibleRules.sort((a, b) => b.rate - a.rate)[0];

  if (!rule && categoryExcluded) {
    warnings.push(excludedMsg);
    return result({ ruleLabel: "Excluded", reason: "Excluded category" });
  }
  if (!rule) {
    const units = baseUnits(lookup.amount);
    const rateText = card.base.tiers ? "base rate (spend slab applies)" : `${round2(card.base.rate * 100)}${card.reward.kind === "cashback" ? "%" : ` ${card.reward.unitName} per ₹100`}`;
    return result({ rewardUnits: units, ruleLabel: "Base rate", reason: `No bonus category matches; earns the ${rateText}.` });
  }

  // 4. Apply the rule, its cap, and any overflow.
  const raw = lookup.amount * rule.rate;
  let units = raw;
  if (rule.capId) {
    const cap = capOf(rule.capId)!;
    const left = remaining(rule.capId);
    if (raw > left) {
      units = left;
      const coveredSpend = left / rule.rate;
      const overflowSpend = lookup.amount - coveredSpend;
      warnings.push(
        left === 0
          ? `${cap.label} already used up this ${cap.period}.`
          : `Hits the ${cap.label}: only ${inr(left * card.reward.inrPerUnit)} of bonus left.`,
      );
      if (cap.overflow === "base") units += baseUnits(overflowSpend);
    }
    capConsumption[rule.capId] = (capConsumption[rule.capId] ?? 0) + Math.min(raw, left);
    const after = remaining(rule.capId);
    if (after > 0 && after < cap.amount * 0.2) {
      warnings.push(`Only ${inr(after * card.reward.inrPerUnit)} left on the ${cap.label} this ${cap.period}.`);
    }
  }
  return result({ rewardUnits: units, ruleLabel: rule.label, reason: rule.label });
}

/** Rank the user's cards for a purchase. Usable cards first, then by ₹ value. */
export function recommend(cards: Card[], lookup: Lookup, states: Record<string, CardState> = {}): Recommendation[] {
  return cards
    .map((c) => evaluate(c, lookup, states[c.id]))
    .sort((a, b) => Number(b.usable) - Number(a.usable) || b.valueInr - a.valueInr);
}
