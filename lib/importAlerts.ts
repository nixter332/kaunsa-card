// Turns read bank alerts into logged payments, the same way "I paid with this card" does,
// so monthly limits, Savings and "missed by using another card" fill in on their own.
import { matchCard, shopKey, txnKey, type AlertTxn } from "./alerts";
import { evaluate, recommend } from "./engine";
import { MERCHANTS } from "./localParse";
import type { Card, CardState, Category, Channel } from "./types";

/** The parts of a logged payment this needs (the app's LedgerEntry has these and more). */
export type ImportedEntry = {
  ts: number;
  cardId: string;
  capConsumption: Record<string, number>;
  amount: number;
  earned?: number;
  best?: number;
  bestCardId?: string;
  label?: string;
  source?: "gmail" | "manual";
  key?: string;
  msgId?: string;
  /** Known shop id, when the alert named one the app knows. */
  merchant?: string;
  /** What it was valued as. Unknown shops are "other" until the person says. */
  category?: Category;
  channel?: Channel;
  /** Unknown shop, as remembered on the phone ("JIMIS BURGER"), so one answer covers every payment there. */
  shop?: string;
  /** The person said what this shop is (or did earlier, for the same shop). */
  kindSet?: boolean;
};

/** What a shop the app doesn't know can be. Picked by the person; plain categories, no guessing from the name. */
export const SHOP_KINDS = [
  { id: "dining", label: "Eating out", category: "dining", channel: "offline" },
  { id: "food", label: "Food delivery", category: "food_delivery", channel: "online" },
  { id: "grocery", label: "Groceries", category: "grocery", channel: "offline" },
  { id: "shopping", label: "Online shopping", category: "online_shopping", channel: "online" },
  { id: "travel", label: "Travel", category: "travel", channel: "online" },
  { id: "cab", label: "Cabs", category: "cab", channel: "online" },
  { id: "fuel", label: "Fuel", category: "fuel", channel: "offline" },
  { id: "bills", label: "Bills", category: "utilities", channel: "online" },
  { id: "movies", label: "Movies", category: "movies", channel: "online" },
  { id: "other_online", label: "Other, online", category: "other", channel: "online" },
  { id: "other_offline", label: "Other, in person", category: "other", channel: "offline" },
] as const satisfies readonly { id: string; label: string; category: Category; channel: Channel }[];
export type ShopKindId = (typeof SHOP_KINDS)[number]["id"];

/**
 * The unknown shop behind an imported payment, if any. Payments imported before shops were remembered (15 Nov 2026)
 * have only a label: a label that's one of our shop names was a known shop; anything else is treated as unknown.
 */
export function shopOf(e: ImportedEntry): string | undefined {
  if (e.source !== "gmail" || e.merchant) return undefined;
  if (e.shop) return e.shop;
  if (e.category || !e.label || MERCHANTS.some((m) => m.name === e.label)) return undefined;
  return shopKey(e.label);
}

/** Imported payments at shops the person hasn't named yet: these are valued at the card's base rate. */
export const needsKind = (e: ImportedEntry) => !e.kindSet && (e.category ?? "other") === "other" && !!shopOf(e);

export type Incoming = AlertTxn & { msgId: string; fallbackTs: number };

/** An alert whose card couldn't be worked out: the app asks once which card has these last 4 digits. */
export type Unmatched = { msgId: string; issuer: string; last4?: string; amount: number; label: string; ts: number };

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export type ImportResult<E extends ImportedEntry> = {
  ledger: E[];
  added: number;
  skipped: number;
  unmatched: Unmatched[];
  learned: Record<string, string>;
  unknownMerchant: number;
};

type States<E> = (ledger: E[], at: number) => Record<string, CardState>;

/** One payment valued with the card's limits as they stood at its time (everything else in `ledger` counted). */
function value(card: Card, cards: Card[], amount: number, category: Category, channel: Channel, merchant: string | undefined, s: Record<string, CardState>) {
  const lookup = { merchant, category, channel, rail: "card" as const, amount };
  const r = evaluate(card, lookup, s[card.id]);
  const best = recommend(cards, lookup, s).find((x) => x.usable);
  return { capConsumption: r.capConsumption, earned: r.totalInr, best: best?.totalInr, bestCardId: best?.cardId };
}

/**
 * Add alerts to the ledger, oldest first, each valued with the card's limits as they stood then.
 * Skips: alerts already imported (same message or same card+amount+minute), payments already logged by hand
 * (same card and amount within a day), and cards the user said aren't theirs (`ignoredLast4`).
 * Unknown shops the person has already named (`shopKinds`) are valued as what they said.
 */
export function importAlerts<E extends ImportedEntry>(opts: {
  incoming: Incoming[];
  ledger: E[];
  cards: Card[];
  last4: Record<string, string>;
  ignoredLast4: string[];
  states: States<E>;
  shopKinds?: Record<string, ShopKindId>;
}): ImportResult<E> {
  const { cards, ignoredLast4, states } = opts;
  const shopKinds = opts.shopKinds ?? {};
  const last4 = { ...opts.last4 };
  const learned: Record<string, string> = {};
  let ledger = [...opts.ledger];
  const seenMsg = new Set(ledger.map((e) => e.msgId).filter(Boolean));
  const seenKey = new Set(ledger.map((e) => e.key).filter(Boolean));
  const unmatched: Unmatched[] = [];
  let added = 0;
  let skipped = 0;
  let unknownMerchant = 0;

  for (const t of [...opts.incoming].sort((a, b) => (a.ts ?? a.fallbackTs) - (b.ts ?? b.fallbackTs))) {
    const ts = t.ts ?? t.fallbackTs;
    if (seenMsg.has(t.msgId) || (t.last4 && ignoredLast4.includes(t.last4))) {
      skipped++;
      continue;
    }
    const label = t.merchant?.name ?? titleCase(t.merchantRaw.replace(/^(?:[a-z]{2,6}\s*\*\s*)+/i, ""));
    const card = matchCard(t, cards, last4);
    if (!card) {
      unmatched.push({ msgId: t.msgId, issuer: t.issuer, last4: t.last4, amount: t.amount, label, ts });
      continue;
    }
    if (t.last4 && !last4[card.id]) last4[card.id] = learned[card.id] = t.last4;
    const key = txnKey(t, card.id);
    const byHand = ledger.some((e) => e.source !== "gmail" && e.cardId === card.id && Math.abs(e.amount - t.amount) < 1 && Math.abs(e.ts - ts) < 86_400_000);
    if (seenKey.has(key) || byHand) {
      skipped++;
      seenMsg.add(t.msgId);
      continue;
    }
    const shop = t.merchant ? undefined : shopKey(t.merchantRaw);
    const named = shop ? SHOP_KINDS.find((k) => k.id === shopKinds[shop]) : undefined;
    const category: Category = t.merchant?.category ?? named?.category ?? "other";
    const channel: Channel = t.merchant?.channel ?? named?.channel ?? "offline";
    if (!t.merchant && !named) unknownMerchant++;
    const entry = {
      ts,
      cardId: card.id,
      amount: t.amount,
      ...value(card, cards, t.amount, category, channel, t.merchant?.id, states(ledger, ts)),
      label,
      source: "gmail",
      key,
      msgId: t.msgId,
      merchant: t.merchant?.id,
      category,
      channel,
      shop,
      kindSet: named ? true : undefined,
    } as E;
    ledger = [...ledger, entry];
    seenMsg.add(t.msgId);
    seenKey.add(key);
    added++;
  }
  return { ledger, added, skipped, unmatched, learned, unknownMerchant };
}

/**
 * The person said what an unknown shop is: every imported payment there is valued again as that, oldest first,
 * with the card's limits as they stood at the time. Returns how many payments changed and the ₹ difference.
 */
export function setShopKind<E extends ImportedEntry>(opts: { ledger: E[]; shop: string; kind: ShopKindId; cards: Card[]; states: States<E> }) {
  const kind = SHOP_KINDS.find((k) => k.id === opts.kind)!;
  let ledger = [...opts.ledger];
  let changed = 0;
  let before = 0;
  let after = 0;
  const targets = ledger.filter((e) => shopOf(e) === opts.shop).sort((a, b) => a.ts - b.ts);
  for (const old of targets) {
    const card = opts.cards.find((c) => c.id === old.cardId);
    const rest = ledger.filter((e) => e !== old);
    const valued = card ? value(card, opts.cards, old.amount, kind.category, kind.channel, undefined, opts.states(rest, old.ts)) : {};
    const next = { ...old, ...valued, category: kind.category, channel: kind.channel, shop: opts.shop, kindSet: true } as E;
    ledger = ledger.map((e) => (e === old ? next : e));
    before += old.earned ?? 0;
    after += next.earned ?? 0;
    changed++;
  }
  return { ledger, changed, deltaInr: after - before };
}
