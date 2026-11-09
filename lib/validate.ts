// Checks that card data is internally consistent before it reaches users.
import { CATEGORIES, CONDITIONS, type Card, type Rule } from "./types";

export function validateCard(c: Partial<Card>): string[] {
  const errs: string[] = [];
  const capIds = new Set((c.caps ?? []).map((x) => x.id));
  const okRate = (r: number) => typeof r === "number" && r >= 0 && r <= 0.5;
  if (!c.base || !okRate(c.base.rate)) errs.push("base.rate missing or outside 0–0.5");
  if (c.base?.capId && !capIds.has(c.base.capId)) errs.push(`base.capId "${c.base.capId}" has no matching cap`);
  for (const r of c.rules ?? []) {
    if (!okRate(r.rate)) errs.push(`rule ${r.id}: rate ${r.rate} outside 0–0.5`);
    if (r.capId && !capIds.has(r.capId)) errs.push(`rule ${r.id}: capId "${r.capId}" has no matching cap`);
    if (!r.merchants?.length && !r.categories?.length && !r.rails?.length && !r.channels?.length && !r.requires) {
      errs.push(`rule ${r.id}: needs merchants, categories, a channel, a rail or a condition (otherwise it would apply to everything)`);
    }
    if (r.requires && !(r.requires in CONDITIONS)) errs.push(`rule ${r.id}: unknown condition "${r.requires}"`);
    if (r.rails?.includes("upi") && c.upi === false) errs.push(`rule ${r.id}: UPI rate on a card that can't be used on UPI`);
    for (const cat of r.categories ?? []) if (!CATEGORIES.includes(cat)) errs.push(`rule ${r.id}: unknown category "${cat}"`);
    if (r.note !== undefined && !(r.note.trim().length > 0 && r.note.length <= 160)) errs.push(`rule ${r.id}: note must be one short sentence (up to 160 characters)`);
    if (r.evidence && !(r.evidence.quote?.trim() && r.evidence.source?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(r.evidence.checked ?? "")))
      errs.push(`rule ${r.id}: evidence needs a quote, a source and a checked date (YYYY-MM-DD)`);
  }
  for (const cap of c.caps ?? []) {
    if (!(cap.amount > 0)) errs.push(`cap ${cap.id}: amount must be > 0`);
    if (!["month", "quarter"].includes(cap.period)) errs.push(`cap ${cap.id}: period must be month or quarter`);
  }
  for (const cat of c.exclusions?.categories ?? []) if (!CATEGORIES.includes(cat)) errs.push(`unknown excluded category "${cat}"`);
  if (c.exclusions?.categories.includes("other")) errs.push(`"other" can't be excluded: it would zero out every unrecognised merchant`);
  if (c.upi && c.network !== "RuPay") errs.push("only RuPay cards can be used on UPI");
  if (c.reward && !(c.reward.kind === "cashback" && c.reward.inrPerUnit === 1)) {
    if (!c.reward.valueBasis?.trim()) errs.push("points card needs reward.valueBasis (what the ₹ value assumes, shown to users)");
    if (c.reward.valueStated === undefined) errs.push("points card needs reward.valueStated (does the bank's document state the ₹ value?)");
  }
  if (c.confidence === "high" && c.reward?.valueStated === false) errs.push("confidence can't be high when the point value is our estimate");
  const e = c.reward?.earning;
  if (e) {
    if (!e.block && !e.rounding) errs.push("reward.earning needs a block or a rounding");
    if (e.block !== undefined && !(Number.isInteger(e.block) && e.block > 0 && e.block <= 1000)) errs.push("reward.earning.block must be a whole number of rupees, up to 1000");
    if (e.rounding !== undefined && !["down", "nearest"].includes(e.rounding)) errs.push('reward.earning.rounding must be "down" or "nearest"');
    if (!(e.evidence?.quote?.trim() && e.evidence.source?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(e.evidence.checked ?? "")))
      errs.push("reward.earning needs evidence from the bank's document (run npm run evidence -- --quote <card>/earning=...)");
  }
  return errs;
}

/** Human-readable differences between the current and proposed rules. */
export function diffCards(oldC: Partial<Card> | undefined, newC: Partial<Card>): string[] {
  if (!oldC) {
    const empty: Partial<Card> = { network: undefined, base: undefined, rules: [], caps: [], exclusions: { categories: [], merchants: [] } };
    return ["NEW CARD: review every line below.", ...diffCards(empty, newC)];
  }
  const out: string[] = [];
  const unit = newC.reward?.inrPerUnit ?? 1;
  const pct = (r?: number) => {
    if (r === undefined) return "—";
    const value = `${Math.round(r * unit * 10000) / 100}%`;
    return unit === 1 ? value : `${Math.round(r * 10000) / 100} ${newC.reward?.unitName ?? "points"}/₹100 (≈${value} value)`;
  };
  if (oldC.base?.rate !== newC.base?.rate) out.push(`Base rate: ${pct(oldC.base?.rate)} → ${pct(newC.base?.rate)}`);
  for (const field of ["network", "upi", "minTxn"] as const) {
    if (oldC[field] !== newC[field]) out.push(`~ ${field}: ${oldC[field] ?? "—"} → ${newC[field] ?? "—"}`);
  }
  if (oldC.reward?.inrPerUnit !== newC.reward?.inrPerUnit) out.push(`~ Value per unit: ₹${oldC.reward?.inrPerUnit} → ₹${newC.reward?.inrPerUnit}`);
  // Match rules by id, or by what they cover if the id changed.
  const scope = (r: Rule) =>
    [[...(r.merchants ?? []), ...(r.categories ?? [])].sort().join(","), (r.rails ?? []).join(","), r.requires ?? ""].join("|");
  const unmatchedOld = [...(oldC.rules ?? [])];
  for (const r of newC.rules ?? []) {
    const i = unmatchedOld.findIndex((o) => o.id === r.id || scope(o) === scope(r));
    if (i < 0) {
      const extra = [r.rails?.length ? `on ${r.rails.join("/")}` : "", r.requires ? `needs ${r.requires}` : "", r.capId ? `cap ${r.capId}` : ""].filter(Boolean).join(", ");
      out.push(`+ Rule "${r.label}" at ${pct(r.rate)}${extra ? ` (${extra})` : ""}`);
      continue;
    }
    const [o] = unmatchedOld.splice(i, 1);
    if (o.rate !== r.rate) out.push(`~ Rule "${r.label}": ${pct(o.rate)} → ${pct(r.rate)}`);
    else if (o.requires !== r.requires || JSON.stringify(o.rails) !== JSON.stringify(r.rails)) out.push(`~ Rule "${r.label}": condition or rail changed`);
    if ((o.note ?? "") !== (r.note ?? "")) out.push(`~ Rule "${r.label}": note ${r.note ? `now "${r.note}"` : "removed"}`);
    const capOf = (c: Partial<Card>, id?: string) => {
      const cap = c.caps?.find((x) => x.id === id);
      return cap ? `${cap.amount}/${cap.period}/${cap.overflow}` : "none";
    };
    if (scope(o) !== scope(r) || capOf(oldC, o.capId) !== capOf(newC, r.capId) || o.minTxn !== r.minTxn) {
      out.push(`~ Rule "${r.label}": scope, cap or minimum changed`);
    }
  }
  for (const o of unmatchedOld) out.push(`- Rule "${o.label}" removed`);
  const unmatchedCaps = [...(oldC.caps ?? [])];
  for (const cap of newC.caps ?? []) {
    const i = unmatchedCaps.findIndex((c) => c.id === cap.id || (c.amount === cap.amount && c.period === cap.period && c.label.split(" ")[0] === cap.label.split(" ")[0]));
    const o = i >= 0 ? unmatchedCaps.splice(i, 1)[0] : undefined;
    if (!o) out.push(`+ Cap "${cap.label}": ${cap.amount}/${cap.period}`);
    else if (o.amount !== cap.amount || o.period !== cap.period) out.push(`~ Cap "${cap.label}": ${o.amount}/${o.period} → ${cap.amount}/${cap.period}`);
  }
  for (const c of unmatchedCaps) out.push(`- Cap "${c.label}" removed`);
  const oldEx = new Set(oldC.exclusions?.categories ?? []);
  const newEx = new Set(newC.exclusions?.categories ?? []);
  for (const e of newEx) if (!oldEx.has(e)) out.push(`+ Excludes ${e}`);
  for (const e of oldEx) if (!newEx.has(e)) out.push(`- No longer excludes ${e}`);
  return out.length ? out : ["No changes to rates, caps or exclusions."];
}

/**
 * Did the source document actually confirm this card's earn rates?
 * Needs the model's own yes AND at least one rule backed by a real quote (or no rules at all, e.g. a flat-rate card).
 */
export function isConfirmedByDocument(modelSaysStated: boolean | undefined, rules: { evidence?: string }[]): boolean {
  if (!modelSaysStated) return false;
  if (rules.length === 0) return true;
  return rules.some((r) => r.evidence && !r.evidence.startsWith("KEPT"));
}

/**
 * Tidy a proposal before it's checked or applied:
 * - a rule that applies to everything at the base rate is really the base rate (its cap moves to base.capId)
 * - caps no rule or base uses are dropped (they'd show in the app as caps that never fill)
 */
export function normalizeCard<T extends Partial<Card>>(c: T): { card: T; changes: string[] } {
  const changes: string[] = [];
  const card = structuredClone(c);
  const rules = card.rules ?? [];
  const isEverything = (r: Rule) => !r.merchants?.length && !r.categories?.length && !r.rails?.length && !r.channels?.length && !r.requires;
  for (const r of [...rules]) {
    if (isEverything(r) && card.base && r.rate === card.base.rate) {
      if (r.capId && !card.base.capId) card.base.capId = r.capId;
      if (r.minTxn && !card.minTxn) card.minTxn = r.minTxn;
      rules.splice(rules.indexOf(r), 1);
      changes.push(`Rule "${r.label}" is the base rate, so it was folded into the base${r.capId ? " with its cap" : ""}.`);
    }
  }
  const used = new Set([card.base?.capId, ...rules.map((r) => r.capId)].filter(Boolean));
  const unused = (card.caps ?? []).filter((cap) => !used.has(cap.id));
  if (unused.length) {
    card.caps = (card.caps ?? []).filter((cap) => used.has(cap.id));
    for (const cap of unused) changes.push(`Cap "${cap.label}" isn't attached to any rule, so it was dropped.`);
  }
  card.rules = rules;
  if (card.confidence === "high" && card.reward?.valueStated === false) {
    card.confidence = "medium";
    changes.push("Confidence lowered to medium: the point value isn't stated in the bank's documents.");
  }
  return { card, changes };
}
