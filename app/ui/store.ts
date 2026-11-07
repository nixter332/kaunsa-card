// Device-only persistence, analytics hook, and helpers shared by the screens.
import cardsJson from "@/data/cards.json";
import offersJson from "@/data/offers.json";
import profilesJson from "@/data/card-profiles.json";
import { capture } from "@/lib/analytics";
import { istMonth, offerUseKey } from "@/lib/offers";
import type { Card, CardProfile, CardState, Condition, Lookup, Offer } from "@/lib/types";

export const ALL_CARDS = cardsJson as Card[];
export const cardById = (id: string) => ALL_CARDS.find((c) => c.id === id);
export const ALL_OFFERS = offersJson as Offer[];
export const ALL_PROFILES = profilesJson as CardProfile[];

export type LedgerEntry = {
  ts: number;
  cardId: string;
  capConsumption: Record<string, number>;
  amount: number;
  earned?: number; // ₹ value earned with the card used
  best?: number; // ₹ value the best card would have earned
  bestCardId?: string;
  label?: string; // what the payment was, e.g. "Myntra"
  offerId?: string; // bank offer or card perk used, for "once a month" limits
  discount?: number; // ₹ instant discount from that offer (included in earned)
};

/** How many times each offer was used on each card this month (India time). Key: offerId|cardId. */
export function offerUsesFromLedger(ledger: LedgerEntry[], now = new Date()): Record<string, number> {
  const month = istMonth(now);
  const uses: Record<string, number> = {};
  for (const e of ledger) {
    if (!e.offerId || istMonth(new Date(e.ts)) !== month) continue;
    const k = offerUseKey(e.offerId, e.cardId);
    uses[k] = (uses[k] ?? 0) + 1;
  }
  return uses;
}

export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
export function track(event: string, props: Record<string, unknown> = {}) {
  // Sent to PostHog when configured (anonymous), and kept in a short on-device log.
  capture(event, props);
  const log = load<{ e: string; ts: number; p: Record<string, unknown> }[]>("cs.events", []);
  log.push({ e: event, ts: Date.now(), p: props });
  save("cs.events", log.slice(-200));
}

export const periodKey = (ts: number, period: "month" | "quarter") => {
  const d = new Date(ts);
  return period === "month" ? `${d.getFullYear()}-${d.getMonth()}` : `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3)}`;
};

/** Conditions a card's rules depend on, e.g. Amazon Prime. */
export const conditionsOf = (card: Card) => [...new Set(card.rules.map((r) => r.requires).filter(Boolean))] as Condition[];

export function statesFromLedger(cards: Card[], ledger: LedgerEntry[], met: string[] = []): Record<string, CardState> {
  const now = Date.now();
  const states: Record<string, CardState> = {};
  for (const card of cards) {
    const capUsed: Record<string, number> = {};
    for (const entry of ledger.filter((e) => e.cardId === card.id)) {
      for (const [capId, units] of Object.entries(entry.capConsumption)) {
        const cap = card.caps.find((c) => c.id === capId);
        if (cap && periodKey(entry.ts, cap.period) === periodKey(now, cap.period)) capUsed[capId] = (capUsed[capId] ?? 0) + units;
      }
    }
    const year = new Date(now).getFullYear();
    const annualSpend = ledger.filter((e) => e.cardId === card.id && new Date(e.ts).getFullYear() === year).reduce((s, e) => s + e.amount, 0);
    const conditions = conditionsOf(card).filter((c) => met.includes(`${card.id}:${c}`));
    states[card.id] = { capUsed, annualSpend, conditions };
  }
  return states;
}

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
export const pretty = (s: string) => {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Card colours by brand family. Plain colours only, no logos. */
export function cardColors(card: Card): [string, string] {
  const k = `${card.name} ${card.issuer}`.toLowerCase();
  const table: [string, [string, string]][] = [
    ["swiggy", ["#d4691f", "#7c3510"]],
    ["flipkart", ["#2e5fd0", "#173a85"]],
    ["amazon", ["#36495c", "#161f29"]],
    ["airtel", ["#c0313a", "#6b1418"]],
    ["tata neu", ["#6a3596", "#341a4c"]],
    ["super.money", ["#4a46d6", "#23206e"]],
    ["scapia", ["#4d47b8", "#221f63"]],
    ["kiwi", ["#3a8f57", "#184a2a"]],
    ["hsbc", ["#5c6168", "#25282d"]],
    ["indusind", ["#7d2a41", "#3a1220"]],
    ["hdfc", ["#24498f", "#0f2147"]],
    ["axis", ["#8c2647", "#4a0f24"]],
    ["sbi", ["#2368b4", "#123a6b"]],
    ["icici", ["#b05624", "#5e2a10"]],
  ];
  return table.find(([key]) => k.includes(key))?.[1] ?? ["#3a4a44", "#1b2420"];
}

export type Tile = {
  id: string;
  label: string;
  hint: string;
  category: Lookup["category"];
  channel: Lookup["channel"];
  rail: Lookup["rail"];
  merchants: string[];
};

export const TILES: Tile[] = [
  { id: "food", label: "Food delivery", hint: "Swiggy, Zomato", category: "food_delivery", channel: "online", rail: "card", merchants: ["swiggy_food", "zomato"] },
  { id: "dining", label: "Dining out", hint: "Restaurants, cafés", category: "dining", channel: "offline", rail: "card", merchants: ["restaurant", "swiggy_dineout"] },
  { id: "grocery", label: "Groceries", hint: "Instamart, Blinkit…", category: "grocery", channel: "online", rail: "card", merchants: ["swiggy_instamart", "blinkit", "zepto", "bigbasket", "kirana"] },
  { id: "shopping", label: "Shopping", hint: "Amazon, Myntra…", category: "online_shopping", channel: "online", rail: "card", merchants: ["amazon", "flipkart", "myntra", "ajio", "nykaa", "meesho", "croma", "tata_cliq"] },
  { id: "travel", label: "Travel & cabs", hint: "Flights, trains, Uber", category: "travel", channel: "online", rail: "card", merchants: ["goibibo", "makemytrip", "cleartrip", "easemytrip", "irctc", "scapia_travel", "uber", "ola"] },
  { id: "bills", label: "Bills", hint: "Electricity, phone", category: "utilities", channel: "online", rail: "card", merchants: ["electricity", "mobile_recharge", "airtel_bill", "gpay_bill"] },
  { id: "upi", label: "Scan & pay", hint: "Any UPI QR", category: "other", channel: "offline", rail: "upi", merchants: ["kirana", "restaurant"] },
  { id: "movies", label: "Movies", hint: "BookMyShow, PVR", category: "movies", channel: "online", rail: "card", merchants: ["bookmyshow", "pvr", "district"] },
  { id: "fuel", label: "Fuel", hint: "Petrol pumps", category: "fuel", channel: "offline", rail: "card", merchants: ["petrol"] },
];
