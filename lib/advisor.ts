// Card advisor: given someone's monthly spending, which set of cards earns them the most after fees?
// Uses the same rules engine as lookups, so every rupee comes from verified card terms. No AI here.
import { evaluate } from "./engine";
import type { Card, CardProfile, CardState, Lookup } from "./types";

export type SpendBucket = { id: string; label: string; hint: string; lookup: Omit<Lookup, "amount"> };

/** Where money goes in a month. Each maps to a lookup, so merchant-specific card rates apply. */
export const SPEND_BUCKETS: SpendBucket[] = [
  { id: "swiggy", label: "Swiggy & Instamart", hint: "Food and groceries on Swiggy", lookup: { merchant: "swiggy_food", category: "food_delivery", channel: "online", rail: "card" } },
  { id: "zomato", label: "Zomato", hint: "Food delivery", lookup: { merchant: "zomato", category: "food_delivery", channel: "online", rail: "card" } },
  { id: "grocery", label: "Other grocery apps", hint: "Blinkit, Zepto, BigBasket", lookup: { category: "grocery", channel: "online", rail: "card" } },
  { id: "dining", label: "Eating out", hint: "Restaurants, cafés, bars", lookup: { merchant: "restaurant", category: "dining", channel: "offline", rail: "card" } },
  { id: "amazon", label: "Amazon", hint: "Shopping on Amazon", lookup: { merchant: "amazon", category: "online_shopping", channel: "online", rail: "card" } },
  { id: "flipkart", label: "Flipkart", hint: "Shopping on Flipkart", lookup: { merchant: "flipkart", category: "online_shopping", channel: "online", rail: "card" } },
  { id: "myntra", label: "Myntra", hint: "Clothes and shoes", lookup: { merchant: "myntra", category: "apparel", channel: "online", rail: "card" } },
  { id: "shopping", label: "Other online shopping", hint: "Ajio, Nykaa, electronics…", lookup: { category: "online_shopping", channel: "online", rail: "card" } },
  { id: "travel", label: "Flights & hotels", hint: "Booked online", lookup: { category: "travel", channel: "online", rail: "card" } },
  { id: "cabs", label: "Cabs", hint: "Uber, Ola, Rapido", lookup: { merchant: "uber", category: "cab", channel: "online", rail: "card" } },
  { id: "bills", label: "Bills & recharges", hint: "Electricity, phone, broadband", lookup: { category: "utilities", channel: "online", rail: "card" } },
  { id: "movies", label: "Movies", hint: "BookMyShow, PVR", lookup: { merchant: "bookmyshow", category: "movies", channel: "online", rail: "card" } },
  { id: "fuel", label: "Fuel", hint: "Petrol pumps", lookup: { category: "fuel", channel: "offline", rail: "card" } },
  { id: "rent", label: "Rent", hint: "Paid by card", lookup: { category: "rent", channel: "online", rail: "card" } },
  { id: "upi", label: "UPI at shops", hint: "Scan & pay: kirana, chai, auto", lookup: { category: "other", channel: "offline", rail: "upi" } },
  { id: "other", label: "Everything else on card", hint: "Stores, pharmacies, others", lookup: { category: "other", channel: "offline", rail: "card" } },
];

export const INCOME_BANDS = [
  { id: "lt25", label: "Under ₹25k", min: 0, max: 25_000 },
  { id: "25-50", label: "₹25k–50k", min: 25_000, max: 50_000 },
  { id: "50-100", label: "₹50k–1L", min: 50_000, max: 100_000 },
  { id: "100-200", label: "₹1L–2L", min: 100_000, max: 200_000 },
  { id: "200+", label: "Over ₹2L", min: 200_000, max: Infinity },
] as const;

export type AdvisorInput = {
  incomeBand: (typeof INCOME_BANDS)[number]["id"];
  spends: Record<string, number>; // ₹ per month by bucket id
  lounge: "none" | "domestic" | "international";
  fees: "free" | "low" | "any"; // low = up to ₹1,000 a year after waivers
  newCards: number; // how many new cards they're open to, 0–3
  amazonPrime: boolean;
  travelsAbroad: boolean;
};

export const DEFAULT_INPUT: AdvisorInput = {
  incomeBand: "50-100",
  spends: {},
  lounge: "none",
  fees: "low",
  newCards: 2,
  amazonPrime: false,
  travelsAbroad: false,
};

/** A new card has to add at least this much a year to be worth applying for. */
export const MIN_GAIN_PER_NEW_CARD = 500;

export type RouteRow = { bucketId: string; monthlySpend: number; cardId: string | null; monthlyValue: number };
export type CardYear = { spend: number; rewards: number; fee: number; feeKnown: boolean; waived: boolean; net: number; buckets: string[] };
export type Portfolio = {
  cardIds: string[];
  routing: RouteRow[];
  perCard: Record<string, CardYear>;
  yearlyRewards: number;
  yearlyFees: number;
  net: number;
  lounge: { domestic: number; international: number };
};

export type Outcome = {
  cardId: string;
  status: "add" | "keep" | "spare" | "drop";
  year: CardYear;
  profile?: CardProfile;
  why: string;
};

export type Advice = {
  current: Portfolio;
  best: Portfolio;
  gain: number; // ₹ per year better than today
  outcomes: Outcome[];
  notes: string[];
  unknownFees: string[]; // cards without checked fees (not suggested as new)
};

const round = (n: number) => Math.round(n);
const rupees = (n: number) => `₹${round(n).toLocaleString("en-IN")}`;

/** Quarterly caps are simulated as a third per month, so one simulated month stays honest. */
function monthly(card: Card): Card {
  if (!card.caps.some((c) => c.period !== "month")) return card;
  return { ...card, caps: card.caps.map((c) => (c.period === "month" ? c : { ...c, amount: c.amount / 3, period: "month" as const })) };
}

/** Route one month of spending across these cards (biggest spends first, caps carry over between them). */
export function route(cards: Card[], input: AdvisorInput): RouteRow[] {
  const sim = cards.map(monthly);
  const states: Record<string, CardState> = Object.fromEntries(
    sim.map((c) => [c.id, { capUsed: {}, conditions: input.amazonPrime ? ["amazon_prime"] : [] } as CardState]),
  );
  const rows: RouteRow[] = [];
  const buckets = SPEND_BUCKETS.filter((b) => (input.spends[b.id] ?? 0) > 0).sort((a, b) => input.spends[b.id] - input.spends[a.id]);
  // How useful each card is for spending that's still unassigned. When two cards tie on a spend,
  // the less flexible one takes it, so the flexible card's monthly cap stays free for the rest.
  const flexibility = (card: Card, from: number) =>
    buckets.slice(from + 1).reduce((s, x) => s + evaluate(card, { ...x.lookup, amount: input.spends[x.id] }, states[card.id]).valueInr, 0);
  for (const [i, b] of buckets.entries()) {
    const amount = input.spends[b.id];
    const options = sim
      .map((c) => ({ c, r: evaluate(c, { ...b.lookup, amount }, states[c.id]) }))
      .filter((x) => x.r.usable);
    const top = Math.max(0, ...options.map((x) => x.r.valueInr));
    const tied = options.filter((x) => x.r.valueInr >= top - 1);
    const chosen = tied.length > 1 ? tied.sort((x, y) => flexibility(x.c, i) - flexibility(y.c, i))[0] : tied[0];
    const best = chosen ? { cardId: chosen.c.id, value: chosen.r.valueInr, caps: chosen.r.capConsumption } : null;
    if (best) for (const [k, v] of Object.entries(best.caps)) states[best.cardId].capUsed[k] = (states[best.cardId].capUsed[k] ?? 0) + v;
    rows.push({ bucketId: b.id, monthlySpend: amount, cardId: best?.cardId ?? null, monthlyValue: best?.value ?? 0 });
  }
  return rows;
}

/** A year with these cards: rewards from routing, minus annual fees that the spend doesn't waive. */
export function score(cards: Card[], profiles: CardProfile[], input: AdvisorInput): Portfolio {
  const routing = route(cards, input);
  const perCard: Record<string, CardYear> = {};
  for (const c of cards) {
    const rows = routing.filter((r) => r.cardId === c.id);
    const spend = rows.reduce((s, r) => s + r.monthlySpend, 0) * 12;
    const rewards = rows.reduce((s, r) => s + r.monthlyValue, 0) * 12;
    const p = profiles.find((x) => x.id === c.id);
    const waived = Boolean(p?.feeWaiverSpend && spend >= p.feeWaiverSpend);
    const fee = !p || waived ? 0 : p.annualFee;
    perCard[c.id] = { spend, rewards: round(rewards), fee, feeKnown: Boolean(p), waived, net: round(rewards - fee), buckets: rows.map((r) => r.bucketId) };
  }
  const lounge = { domestic: 0, international: 0 };
  for (const c of cards) {
    const l = profiles.find((x) => x.id === c.id)?.lounge;
    lounge.domestic = Math.min(99, lounge.domestic + (l?.domestic ?? 0));
    lounge.international = Math.min(99, lounge.international + (l?.international ?? 0));
  }
  const yearlyRewards = Object.values(perCard).reduce((s, y) => s + y.rewards, 0);
  const yearlyFees = Object.values(perCard).reduce((s, y) => s + y.fee, 0);
  return { cardIds: cards.map((c) => c.id), routing, perCard, yearlyRewards, yearlyFees, net: yearlyRewards - yearlyFees, lounge };
}

export function eligible(profile: CardProfile, band: AdvisorInput["incomeBand"]): boolean {
  const b = INCOME_BANDS.find((x) => x.id === band) ?? INCOME_BANDS[2];
  return !profile.minIncomeMonthly || profile.minIncomeMonthly <= b.max;
}

function feesOk(p: CardProfile, year: CardYear, pref: AdvisorInput["fees"]): boolean {
  if (pref === "any") return true;
  if (pref === "free") return p.joiningFee === 0 && year.fee === 0;
  return p.joiningFee <= 1000 && year.fee <= 1000;
}

const loungeOk = (p: Portfolio, need: AdvisorInput["lounge"]) =>
  need === "none" || (need === "domestic" ? p.lounge.domestic > 0 || p.lounge.international > 0 : p.lounge.international > 0);

function combos<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  const out: T[][] = [];
  items.forEach((x, i) => combos(items.slice(i + 1), k - 1).forEach((rest) => out.push([x, ...rest])));
  return out;
}

/** Drop held cards whose fee costs more than they add. Free cards are never dropped. */
function pruneHeld(cards: Card[], held: Set<string>, profiles: CardProfile[], input: AdvisorInput): Card[] {
  let set = cards;
  for (;;) {
    const base = score(set, profiles, input);
    // Drop the paid card whose removal helps most, then look again.
    let bestDrop: { set: Card[]; net: number } | null = null;
    for (const c of set) {
      if (!held.has(c.id) || !(base.perCard[c.id]?.fee > 0)) continue;
      const without = set.filter((x) => x.id !== c.id);
      const net = score(without, profiles, input).net;
      if (net > base.net && (!bestDrop || net > bestDrop.net)) bestDrop = { set: without, net };
    }
    if (!bestDrop) return set;
    set = bestDrop.set;
  }
}

export function advise(allCards: Card[], heldIds: string[], profiles: CardProfile[], input: AdvisorInput): Advice {
  const held = allCards.filter((c) => heldIds.includes(c.id));
  const heldSet = new Set(held.map((c) => c.id));
  const current = score(held, profiles, input);
  const notes: string[] = [];
  const unknownFees = allCards.filter((c) => !profiles.some((p) => p.id === c.id)).map((c) => c.id);

  // Candidates: cards with checked details that you're eligible for, ranked by what each adds alone.
  const pool = allCards
    .filter((c) => !heldSet.has(c.id))
    .map((c) => ({ c, p: profiles.find((x) => x.id === c.id) }))
    .filter((x): x is { c: Card; p: CardProfile } => Boolean(x.p) && !x.p!.notIssued && eligible(x.p!, input.incomeBand))
    .map(({ c }) => ({ c, gain: score([...held, c], profiles, input).net - current.net }))
    .filter((x) => x.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 10)
    .map((x) => x.c);

  type Option = { cards: Card[]; port: Portfolio; value: number; lounge: boolean };
  const options: Option[] = [];
  const maxNew = Math.max(0, Math.min(3, input.newCards));
  for (let k = 0; k <= maxNew; k++) {
    for (const extra of combos(pool, k)) {
      const cards = pruneHeld([...held, ...extra], heldSet, profiles, input);
      const port = score(cards, profiles, input);
      const added = cards.filter((c) => !heldSet.has(c.id));
      // Every new card must pass the fee preference and pull its own weight.
      const ok = added.every((c) => {
        const p = profiles.find((x) => x.id === c.id)!;
        if (!feesOk(p, port.perCard[c.id], input.fees)) return false;
        const without = score(cards.filter((x) => x.id !== c.id), profiles, input);
        return port.net - without.net >= MIN_GAIN_PER_NEW_CARD;
      });
      if (!ok) continue;
      options.push({ cards, port, value: port.net - MIN_GAIN_PER_NEW_CARD * added.length, lounge: loungeOk(port, input.lounge) });
    }
  }
  const withLounge = options.filter((o) => o.lounge);
  if (input.lounge !== "none" && !withLounge.length) notes.push(`No combination within your fee and card limits gives ${input.lounge} lounge access, so this ignores lounges.`);
  const pick = (withLounge.length ? withLounge : options).sort((a, b) => b.value - a.value || a.cards.length - b.cards.length)[0];
  const best = pick?.port ?? current;

  const outcomes: Outcome[] = [];
  for (const id of best.cardIds) {
    const year = best.perCard[id];
    const profile = profiles.find((p) => p.id === id);
    if (!heldSet.has(id)) {
      const without = score(allCards.filter((c) => best.cardIds.includes(c.id) && c.id !== id), profiles, input);
      outcomes.push({ cardId: id, status: "add", year, profile, why: `Adds about ${rupees(best.net - without.net)} a year after fees.` });
    } else if (year.rewards === 0) {
      outcomes.push({ cardId: id, status: "spare", year, profile, why: year.fee > 0 ? "None of your spending goes on it." : "None of your spending goes on it. It's free, so keeping it helps your credit history." });
    } else {
      outcomes.push({ cardId: id, status: "keep", year, profile, why: `Earns about ${rupees(year.rewards)} a year on your spending.` });
    }
  }
  for (const c of held) {
    if (best.cardIds.includes(c.id)) continue;
    const y = current.perCard[c.id];
    outcomes.push({ cardId: c.id, status: "drop", year: y, profile: profiles.find((p) => p.id === c.id), why: `Its ${rupees(y.fee)} fee is more than it adds for you.` });
  }
  if (held.some((c) => !current.perCard[c.id].feeKnown)) notes.push("Some of your cards' fees aren't checked yet, so their fees count as ₹0 here.");
  if (input.travelsAbroad) notes.push("Abroad, the forex markup (shown per card) usually matters more than rewards.");
  return { current, best, gain: best.net - current.net, outcomes, notes, unknownFees };
}

export function validateProfile(p: CardProfile): string[] {
  const errors: string[] = [];
  const money = (v: unknown) => typeof v === "number" && v >= 0 && v < 1_000_000;
  if (!money(p.joiningFee)) errors.push("joining fee must be ₹0 or more");
  if (!money(p.annualFee)) errors.push("annual fee must be ₹0 or more");
  if (p.feeWaiverSpend !== undefined && !(p.feeWaiverSpend > 0 && p.feeWaiverSpend < 100_000_000)) errors.push("fee waiver spend looks wrong");
  if (p.feeWaiverSpend && p.annualFee === 0) errors.push("a fee waiver on a card with no annual fee");
  for (const n of [p.lounge?.domestic, p.lounge?.international]) if (n !== undefined && !(Number.isInteger(n) && n > 0 && n <= 99)) errors.push("lounge visits must be 1–99 per year");
  if (p.forexMarkupPct !== undefined && !(p.forexMarkupPct >= 0 && p.forexMarkupPct <= 10)) errors.push("forex markup must be 0–10%");
  if (p.minIncomeMonthly !== undefined && !(p.minIncomeMonthly >= 5_000 && p.minIncomeMonthly <= 2_000_000)) errors.push("monthly income requirement looks wrong (annual figure?)");
  if (!p.sources?.length) errors.push("needs a source");
  return errors;
}

export type OnTheTable = {
  /** ₹ a year from the cards you hold, using the best one for each spend. */
  best: number;
  /** The single card that would earn most if you used it for everything, and what it earns. */
  single: { cardId: string; rewards: number } | null;
  /** best − single: what "one card for everything" leaves behind each year. */
  gap: number;
  routing: RouteRow[];
};

/**
 * "What are my cards worth?" With the cards you already hold and your monthly spends: rewards a year
 * if you use the right card each time, against using only your best single card for everything.
 * Fees are the same either way (you hold the cards), so this compares rewards only.
 */
export function onTheTable(held: Card[], profiles: CardProfile[], input: AdvisorInput): OnTheTable {
  const all = score(held, profiles, input);
  let single: OnTheTable["single"] = null;
  for (const c of held) {
    const rewards = score([c], profiles, input).yearlyRewards;
    if (!single || rewards > single.rewards) single = { cardId: c.id, rewards };
  }
  const best = Math.max(all.yearlyRewards, single?.rewards ?? 0);
  return { best, single, gap: Math.max(0, best - (single?.rewards ?? 0)), routing: all.routing };
}
