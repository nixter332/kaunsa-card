// "Your cards' playbook": what each of your cards is best for, built from the same rules the engine uses.
// No AI and no new numbers: every % here is the engine's answer for a ₹1,000 payment with nothing used up yet.
import { evaluate, recommend } from "./engine";
import { offerCovers, offerLive } from "./offers";
import type { Card, CardProfile, Category, Lookup, Merchant, Offer } from "./types";

const AMOUNT = 1000;

/** The spend types people think in, each as a lookup. */
export const PLAYBOOK_SPENDS: { key: string; label: string; lookup: Omit<Lookup, "amount"> }[] = [
  { key: "food_delivery", label: "Food delivery", lookup: { category: "food_delivery", channel: "online", rail: "card" } },
  { key: "dining", label: "Eating out", lookup: { category: "dining", channel: "offline", rail: "card" } },
  { key: "grocery", label: "Groceries (apps)", lookup: { category: "grocery", channel: "online", rail: "card" } },
  { key: "online_shopping", label: "Online shopping", lookup: { category: "online_shopping", channel: "online", rail: "card" } },
  { key: "travel", label: "Flights & hotels", lookup: { category: "travel", channel: "online", rail: "card" } },
  { key: "cab", label: "Cabs", lookup: { category: "cab", channel: "online", rail: "card" } },
  { key: "movies", label: "Movies", lookup: { category: "movies", channel: "online", rail: "card" } },
  { key: "utilities", label: "Bills", lookup: { category: "utilities", channel: "online", rail: "card" } },
  { key: "fuel", label: "Fuel", lookup: { category: "fuel", channel: "offline", rail: "card" } },
  { key: "upi", label: "Scan & pay (UPI)", lookup: { category: "other", channel: "offline", rail: "upi" } },
  { key: "other", label: "Everything else", lookup: { category: "other", channel: "offline", rail: "card" } },
];

export type PlaybookRow = { key: string; label: string; cardId?: string; cardName?: string; pct: number; why?: string };

/** Best of these cards for each spend type. pct 0 with no card = nothing earns (or no card can pay that way). */
export function bestBySpend(cards: Card[]): PlaybookRow[] {
  return PLAYBOOK_SPENDS.map(({ key, label, lookup }) => {
    const best = recommend(cards, { ...lookup, amount: AMOUNT }).find((r) => r.usable);
    if (!best || best.valueInr <= 0) return { key, label, pct: 0 };
    return { key, label, cardId: best.cardId, cardName: best.cardName, pct: best.effectivePct, why: best.ruleLabel };
  });
}

/** Shops where the answer differs from the general one for that spend type (a card's own rate, or a shop a card leaves out). */
export function bestByShop(cards: Card[], merchants: Merchant[], limit = 8): PlaybookRow[] {
  const named = new Set(cards.flatMap((c) => c.rules.flatMap((r) => r.merchants ?? [])));
  const rows: PlaybookRow[] = [];
  for (const m of merchants) {
    if (!named.has(m.id) || m.generic) continue;
    const lookup: Lookup = { merchant: m.id, category: m.category, channel: m.channel, rail: "card", amount: AMOUNT };
    const best = recommend(cards, lookup).find((r) => r.usable);
    const generic = recommend(cards, { ...lookup, merchant: undefined }).find((r) => r.usable);
    if (!best || best.valueInr <= 0) continue;
    if (generic && best.valueInr <= generic.valueInr + 0.5 && best.cardId === generic.cardId) continue;
    rows.push({ key: m.id, label: m.name, cardId: best.cardId, cardName: best.cardName, pct: best.effectivePct, why: best.ruleLabel });
  }
  return rows.sort((a, b) => b.pct - a.pct).slice(0, limit);
}

const pretty = (c: Category) => c.replace(/_/g, " ");
const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

export type CardSheet = {
  cardId: string;
  basePct: number;
  /** Bonus rules, best first: the rule's own label and what it's worth. */
  bestFor: { label: string; pct: number; detail?: string }[];
  earnsNothing: string[];
  watch: string[];
  perks: string[];
  tips: { text: string; source: string }[];
};

/** One card's cheat sheet: where it shines, where it earns nothing, limits to watch, perks and tips. */
export function cardSheet(card: Card, offers: Offer[] = [], profile?: CardProfile, today = new Date()): CardSheet {
  const unit = card.reward.inrPerUnit;
  const basePct = Math.round(card.base.rate * unit * 10000) / 100;
  const capOf = (id?: string) => card.caps.find((c) => c.id === id);
  const bestFor = [...card.rules]
    .filter((r) => r.rate * unit * 100 > basePct + 0.01)
    .sort((a, b) => b.rate - a.rate)
    .map((r) => {
      const cap = capOf(r.capId);
      const detail = [
        cap && `up to ₹${Math.round(cap.amount * unit).toLocaleString("en-IN")} a ${cap.period}`,
        r.minTxn && `on ₹${r.minTxn.toLocaleString("en-IN")}+`,
        r.rails?.length === 1 && r.rails[0] === "upi" && "UPI only",
        r.requires === "amazon_prime" && "needs Prime",
        r.requires === "partner_upi_app" && "via the card's own app or UPI ID",
      ]
        .filter(Boolean)
        .join(", ");
      return { label: r.label, pct: Math.round(r.rate * unit * 10000) / 100, detail: detail || undefined };
    });

  const watch: string[] = [];
  if (card.minTxn) watch.push(`Earns nothing on payments under ₹${card.minTxn.toLocaleString("en-IN")}.`);
  const baseCap = capOf(card.base.capId);
  if (baseCap) watch.push(`Base ${pct(basePct)} stops after ₹${Math.round(baseCap.amount * unit).toLocaleString("en-IN")} a ${baseCap.period}.`);
  for (const r of card.rules) if (r.note && !watch.includes(r.note)) watch.push(r.note);
  if (card.reward.earning?.block) watch.push(`Earns only on whole ₹${card.reward.earning.block}s of each payment.`);
  if (!card.upi) watch.push("Can't be used on UPI.");

  const perks: string[] = [];
  for (const o of offers) {
    if (o.kind !== "card_perk" || !offerCovers(o, card) || !offerLive(o, today)) continue;
    perks.push(o.conditions ? `${o.title}: ${o.conditions}` : o.title);
  }
  const l = profile?.lounge;
  if (l?.domestic || l?.international) {
    const parts = [l.domestic && `${l.domestic === 99 ? "unlimited" : l.domestic} domestic`, l.international && `${l.international === 99 ? "unlimited" : l.international} international`].filter(Boolean);
    perks.push(`Lounge visits a year: ${parts.join(", ")}${l.note ? ". Conditions apply" : ""}`);
  }
  // A highlight that repeats a perk already listed from the offers data (e.g. buy-1-get-1) is skipped.
  const hasBogo = perks.some((p) => /buy 1 get 1/i.test(p));
  for (const h of profile?.highlights ?? []) if (!(hasBogo && /buy\s*(1|one)\s*get\s*(1|one)|bogo/i.test(h))) perks.push(h);

  return {
    cardId: card.id,
    basePct,
    bestFor,
    earnsNothing: card.exclusions.categories.map(pretty),
    watch,
    perks,
    tips: (card.tips ?? []).map((t) => ({ text: t.text, source: t.source })),
  };
}

/** For a base-rate answer: where this card would earn more (top bonus rules), as short labels. */
export function earnsMoreAt(card: Card, limit = 3): string[] {
  return cardSheet(card)
    .bestFor.slice(0, limit)
    .map((b) => b.label);
}

/** Sanity helper for tests: the playbook's % must equal the engine's for the same lookup. */
export const enginePct = (card: Card, lookup: Omit<Lookup, "amount">) => evaluate(card, { ...lookup, amount: AMOUNT }).effectivePct;
