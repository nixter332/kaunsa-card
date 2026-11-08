// Bank offers and card perks: instant discounts from the merchant, on top of the card's own rewards.
// Like the rules engine, nothing here is decided by AI at lookup time: offers come from data/offers.json,
// which the offers agent fills from bank/merchant pages and a human reviews.
import { WEEKDAYS, type AppliedOffer, type Card, type Lookup, type Offer, type OfferTip, type Recommendation, type Weekday } from "./types";

const IST_MS = 5.5 * 3600_000;
/** Today's date in India, as YYYY-MM-DD. */
export const istDate = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
export const istWeekday = (d: Date): Weekday => WEEKDAYS[new Date(d.getTime() + IST_MS).getUTCDay()];
/** Month key in India time, for "once per card per month" limits. */
export const istMonth = (d: Date) => istDate(d).slice(0, 7);

const DAY_LABEL: Record<Weekday, string> = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };
export const dayList = (days: Weekday[]) => WEEKDAYS.filter((d) => days.includes(d)).map((d) => DAY_LABEL[d]).join(", ");
const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** "IndusInd Bank" and "IndusInd" are the same issuer. */
export const normIssuer = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(bank|card|cards|ltd|limited|credit)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

export const offerUseKey = (offerId: string, cardId: string) => `${offerId}|${cardId}`;
/** Uses this calendar year live under the same key with "|year" on the end. */
export const offerYearKey = (offerId: string, cardId: string) => `${offerUseKey(offerId, cardId)}|year`;

/** How many times each offer was used on each card this month and this year (India time), from logged payments. */
export function offerUsesFromLedger(ledger: { ts: number; cardId: string; offerId?: string }[], now = new Date()): Record<string, number> {
  const month = istMonth(now);
  const year = month.slice(0, 4);
  const uses: Record<string, number> = {};
  for (const e of ledger) {
    if (!e.offerId) continue;
    const m = istMonth(new Date(e.ts));
    if (m.slice(0, 4) !== year) continue;
    const y = offerYearKey(e.offerId, e.cardId);
    uses[y] = (uses[y] ?? 0) + 1;
    if (m === month) {
      const k = offerUseKey(e.offerId, e.cardId);
      uses[k] = (uses[k] ?? 0) + 1;
    }
  }
  return uses;
}

/** Does this offer cover this card at all? */
export function offerCovers(offer: Offer, card: Card): boolean {
  if (offer.excludeCardIds?.includes(card.id)) return false;
  if (offer.networks?.length && !offer.networks.includes(card.network)) return false;
  if (offer.cardIds?.length) return offer.cardIds.includes(card.id);
  if (offer.issuer) return normIssuer(offer.issuer) === normIssuer(card.issuer);
  return false;
}

/** Is the offer live on this date (ignoring the day of the week)? */
export function offerLive(offer: Offer, today: Date): boolean {
  const d = istDate(today);
  if (offer.validFrom && d < offer.validFrom) return false;
  if (offer.validTo && d > offer.validTo) return false;
  return true;
}

export function offerDiscount(offer: Offer, amount: number): number {
  if (amount <= 0) return 0;
  const d = offer.discount;
  const raw = d.type === "flat" ? d.value : amount * d.value;
  return Math.round(Math.min(raw, d.type === "percent" && d.max ? d.max : Infinity, amount));
}

export type OfferCheck =
  | { status: "ok"; discount: number }
  | { status: "wrong_day" | "below_min" | "used_up"; discount: number }
  | { status: "no" };

/** Check one offer against one card and purchase. */
export function checkOffer(offer: Offer, card: Card, lookup: Lookup, today: Date, used = 0, usedThisYear = 0): OfferCheck {
  if (!offerCovers(offer, card) || !offerLive(offer, today)) return { status: "no" };
  if (!lookup.merchant || !offer.merchants.includes(lookup.merchant)) return { status: "no" };
  if (offer.categories?.length && !offer.categories.includes(lookup.category)) return { status: "no" };
  if (!(offer.rails ?? ["card"]).includes(lookup.rail)) return { status: "no" };
  if (offer.channels?.length && !offer.channels.includes(lookup.channel)) return { status: "no" };
  if (offer.minTxn && lookup.amount < offer.minTxn) return { status: "below_min", discount: offerDiscount(offer, offer.minTxn) };
  const discount = offerDiscount(offer, lookup.amount);
  if (offer.usesPerMonth && used >= offer.usesPerMonth) return { status: "used_up", discount };
  if (offer.usesPerYear && usedThisYear >= offer.usesPerYear) return { status: "used_up", discount };
  if (offer.days?.length && !offer.days.includes(istWeekday(today))) return { status: "wrong_day", discount };
  return { status: "ok", discount };
}

export function applied(offer: Offer, discountInr: number): AppliedOffer {
  return {
    id: offer.id,
    title: offer.title,
    kind: offer.kind,
    discountInr,
    code: offer.code,
    payment: offer.payment,
    conditions: offer.conditions,
    validTo: offer.validTo,
  };
}

/**
 * The biggest offer this card gets on this purchase today (offers don't stack),
 * plus hints about bigger ones that need another day or a larger amount.
 */
export function bestOffer(
  offers: Offer[],
  card: Card,
  lookup: Lookup,
  today: Date,
  uses: Record<string, number> = {},
): { best?: AppliedOffer; hints: string[]; tips: OfferTip[] } {
  let best: AppliedOffer | undefined;
  const near: OfferTip[] = [];
  const tip = (offer: Offer, reason: OfferTip["reason"], discountInr: number, short: string): OfferTip => ({
    offerId: offer.id,
    reason,
    discountInr,
    text: `${offer.title}: ${short}.`,
    short,
    code: offer.code,
    conditions: offer.conditions,
  });
  for (const offer of offers) {
    const c = checkOffer(offer, card, lookup, today, uses[offerUseKey(offer.id, card.id)] ?? 0, uses[offerYearKey(offer.id, card.id)] ?? 0);
    if (c.status === "ok" && offer.payment === "emi") {
      // Most people pay in full, so an EMI-only deal is a tip, not the answer.
      near.push(tip(offer, "emi", c.discount, `${rupees(c.discount)} off if you pay by no-cost EMI${offer.code ? ` (code ${offer.code})` : ""}`));
    } else if (c.status === "ok") {
      if (!best || c.discount > best.discountInr) best = applied(offer, c.discount);
    } else if (c.status === "wrong_day" && offer.days) {
      near.push(tip(offer, "wrong_day", c.discount, `${rupees(c.discount)} off, but only on ${dayList(offer.days)}`));
    } else if (c.status === "below_min" && offer.minTxn) {
      near.push(tip(offer, "below_min", c.discount, `spend ${rupees(offer.minTxn)} or more to get ${rupees(c.discount)} off`));
    } else if (c.status === "used_up") {
      near.push(tip(offer, "used_up", 0, `already used ${offer.usesPerYear && !offer.usesPerMonth ? "this year" : "this month"} on this card`));
    }
  }
  const tips = near.filter((n) => n.discountInr === 0 || n.discountInr > (best?.discountInr ?? 0));
  return { best, hints: tips.map((t) => t.text), tips };
}

/** Live offers that cover at least one of these cards, soonest-ending first. For the "Offers on your cards" list. */
export function offersForCards(offers: Offer[], cards: Card[], today: Date): { offer: Offer; cards: Card[] }[] {
  return offers
    .filter((o) => offerLive(o, today))
    .map((offer) => ({ offer, cards: cards.filter((c) => offerCovers(offer, c)) }))
    .filter((x) => x.cards.length > 0)
    .sort((a, b) => (a.offer.validTo ?? "9999").localeCompare(b.offer.validTo ?? "9999"));
}

/**
 * Does this look like an offer we already have? The same offer is often published on both the bank's
 * and the merchant's site, with different wording. Same cards, same shop, same deal, overlapping dates.
 */
export function findDuplicate(o: Offer, existing: Offer[]): Offer | undefined {
  const sameCards = (a: Offer, b: Offer) =>
    a.cardIds?.length && b.cardIds?.length
      ? a.cardIds.some((id) => b.cardIds!.includes(id))
      : Boolean(a.issuer && b.issuer && normIssuer(a.issuer) === normIssuer(b.issuer));
  const sameDeal = (a: Offer, b: Offer) =>
    a.discount.type === b.discount.type &&
    Math.abs(a.discount.value - b.discount.value) < 1e-6 &&
    (a.discount.type === "flat" || (a.discount.max ?? 0) === ((b.discount as { max?: number }).max ?? 0));
  const overlap = (a: Offer, b: Offer) => (a.validFrom ?? "0000") <= (b.validTo ?? "9999") && (b.validFrom ?? "0000") <= (a.validTo ?? "9999");
  return existing.find(
    (e) => e.id !== o.id && e.kind === o.kind && e.merchants.some((m) => o.merchants.includes(m)) && sameCards(e, o) && sameDeal(e, o) && overlap(e, o),
  );
}

/** Basic sanity checks, used by the offers agent and the tests. */
export function validateOffer(o: Offer, knownCardIds: string[], knownMerchants: string[], knownIssuers: string[]): string[] {
  const errors: string[] = [];
  if (!o.id || !/^[a-z0-9-]+$/.test(o.id)) errors.push(`id "${o.id}" must be lowercase-with-dashes`);
  if (!o.merchants?.length) errors.push("needs at least one merchant");
  for (const m of o.merchants ?? []) if (!knownMerchants.includes(m)) errors.push(`unknown merchant "${m}"`);
  if (!o.cardIds?.length && !o.issuer) errors.push("needs cardIds or an issuer");
  for (const c of [...(o.cardIds ?? []), ...(o.excludeCardIds ?? [])]) if (!knownCardIds.includes(c)) errors.push(`unknown card "${c}"`);
  if (o.issuer && !knownIssuers.some((i) => normIssuer(i) === normIssuer(o.issuer!))) errors.push(`unknown issuer "${o.issuer}"`);
  if (o.discount?.type === "percent" && !(o.discount.value > 0 && o.discount.value <= 1)) errors.push("percent discount must be between 0 and 1 (0.1 = 10%)");
  if (o.discount?.type === "flat" && !(o.discount.value > 0)) errors.push("flat discount must be positive");
  if (o.kind === "bank_offer" && !o.validTo) errors.push("bank offers need an end date (validTo)");
  for (const d of [o.validFrom, o.validTo]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) errors.push(`date "${d}" must be YYYY-MM-DD`);
  for (const d of o.days ?? []) if (!(WEEKDAYS as readonly string[]).includes(d)) errors.push(`unknown day "${d}"`);
  for (const n of [o.usesPerMonth, o.usesPerYear]) if (n !== undefined && !(Number.isInteger(n) && n > 0 && n <= 60)) errors.push("uses per month/year must be a whole number");
  return errors;
}

/**
 * A no-cost EMI deal on another card (or this one) that beats the top answer by a real margin.
 * We show it above the answer: it's often worth several times the best card's rewards.
 */
export function betterDeal(
  results: Recommendation[],
  minExtra = 100,
): { rec: Recommendation; tip: OfferTip; total: number; extra: number } | undefined {
  const best = results.find((r) => r.usable);
  if (!best) return undefined;
  let pick: { rec: Recommendation; tip: OfferTip; total: number; extra: number } | undefined;
  for (const rec of results) {
    if (!rec.usable) continue;
    for (const tip of rec.offerTips ?? []) {
      if (tip.reason !== "emi") continue;
      const total = tip.discountInr + rec.valueInr;
      const extra = total - best.totalInr;
      if (extra >= minExtra && (!pick || total > pick.total)) pick = { rec, tip, total, extra };
    }
  }
  return pick;
}
