// Turns read bank alerts into logged payments, the same way "I paid with this card" does,
// so monthly limits, Savings and "missed by using another card" fill in on their own.
import { matchCard, txnKey, type AlertTxn } from "./alerts";
import { evaluate, recommend } from "./engine";
import type { Card, CardState } from "./types";

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
};

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

/**
 * Add alerts to the ledger, oldest first, each valued with the card's limits as they stood then.
 * Skips: alerts already imported (same message or same card+amount+minute), payments already logged by hand
 * (same card and amount within a day), and cards the user said aren't theirs (`ignoredLast4`).
 */
export function importAlerts<E extends ImportedEntry>(opts: {
  incoming: Incoming[];
  ledger: E[];
  cards: Card[];
  last4: Record<string, string>;
  ignoredLast4: string[];
  states: (ledger: E[], at: number) => Record<string, CardState>;
}): ImportResult<E> {
  const { cards, ignoredLast4, states } = opts;
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
    const lookup = { merchant: t.merchant?.id, category: t.merchant?.category ?? ("other" as const), channel: t.merchant?.channel ?? ("offline" as const), rail: "card" as const, amount: t.amount };
    if (!t.merchant) unknownMerchant++;
    const s = states(ledger, ts);
    const r = evaluate(card, lookup, s[card.id]);
    const best = recommend(cards, lookup, s).find((x) => x.usable);
    const entry = {
      ts,
      cardId: card.id,
      capConsumption: r.capConsumption,
      amount: t.amount,
      earned: r.totalInr,
      best: best?.totalInr,
      bestCardId: best?.cardId,
      label,
      source: "gmail",
      key,
      msgId: t.msgId,
    } as E;
    ledger = [...ledger, entry];
    seenMsg.add(t.msgId);
    seenKey.add(key);
    added++;
  }
  return { ledger, added, skipped, unmatched, learned, unknownMerchant };
}
