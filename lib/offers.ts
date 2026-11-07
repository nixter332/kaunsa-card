// Bank offers and card perks: instant discounts from the merchant, on top of the card's own rewards.
// Like the rules engine, nothing here is decided by AI at lookup time: offers come from data/offers.json,
// which the offers agent fills from bank/merchant pages and a human reviews.
import { WEEKDAYS, type AppliedOffer, type Card, type Lookup, type Offer, type Weekday } from "./types";

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
export function checkOffer(offer: Offer, card: Card, lookup: Lookup, today: Date, used = 0): OfferCheck {
  if (!offerCovers(offer, card) || !offerLive(offer, today)) return { status: "no" };
  if (!lookup.merchant || !offer.merchants.includes(lookup.merchant)) return { status: "no" };
  if (offer.categories?.length && !offer.categories.includes(lookup.category)) return { status: "no" };
  if (!(offer.rails ?? ["card"]).includes(lookup.rail)) return { status: "no" };
  if (offer.channels?.length && !offer.channels.includes(lookup.channel)) return { status: "no" };
  if (offer.minTxn && lookup.amount < offer.minTxn) return { status: "below_min", discount: offerDiscount(offer, offer.minTxn) };
  const discount = offerDiscount(offer, lookup.amount);
  if (offer.usesPerMonth && used >= offer.usesPerMonth) return { status: "used_up", discount };
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
): { best?: AppliedOffer; hints: string[] } {
  let best: AppliedOffer | undefined;
  const near: { text: string; discount: number }[] = [];
  for (const offer of offers) {
    const c = checkOffer(offer, card, lookup, today, uses[offerUseKey(offer.id, card.id)] ?? 0);
    if (c.status === "ok") {
      if (!best || c.discount > best.discountInr) best = applied(offer, c.discount);
    } else if (c.status === "wrong_day" && offer.days) {
      near.push({ text: `${offer.title}: ${rupees(c.discount)} off, but only on ${dayList(offer.days)}.`, discount: c.discount });
    } else if (c.status === "below_min" && offer.minTxn) {
      near.push({ text: `${offer.title}: spend ${rupees(offer.minTxn)} or more to get ${rupees(c.discount)} off.`, discount: c.discount });
    } else if (c.status === "used_up") {
      near.push({ text: `${offer.title}: already used this month on this card.`, discount: 0 });
    }
  }
  const hints = near.filter((n) => n.discount === 0 || n.discount > (best?.discountInr ?? 0)).map((n) => n.text);
  return { best, hints };
}

/** Live offers that cover at least one of these cards, soonest-ending first. For the "Offers on your cards" list. */
export function offersForCards(offers: Offer[], cards: Card[], today: Date): { offer: Offer; cards: Card[] }[] {
  return offers
    .filter((o) => offerLive(o, today))
    .map((offer) => ({ offer, cards: cards.filter((c) => offerCovers(offer, c)) }))
    .filter((x) => x.cards.length > 0)
    .sort((a, b) => (a.offer.validTo ?? "9999").localeCompare(b.offer.validTo ?? "9999"));
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
  return errors;
}
