// Core domain types for "Which Card to Swipe".
// Rates are expressed as reward UNITS earned per ₹1 spent.
//   cashback card: 0.05 = 5% (1 unit = ₹1)
//   points card:   0.10 = 10 coins per ₹100 (unit value in reward.inrPerUnit)

export const CATEGORIES = [
  "food_delivery",
  "dining",
  "grocery",
  "online_shopping",
  "apparel",
  "electronics",
  "travel",
  "cab",
  "movies",
  "utilities",
  "telecom",
  "fuel",
  "rent",
  "insurance",
  "education",
  "government",
  "wallet_load",
  "jewellery",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Channel = "online" | "offline";
export type Rail = "card" | "upi";

/** One purchase the user is about to make. */
export interface Lookup {
  merchant?: string; // merchant id from data/merchants.json, if known
  category: Category;
  amount: number; // ₹
  channel: Channel;
  rail: Rail;
}

export type CapPeriod = "month" | "quarter";

/** User-specific conditions some rates depend on. Stored per card as "<cardId>:<condition>". */
export const CONDITIONS = {
  amazon_prime: "I have Amazon Prime",
  partner_upi_app: "I pay UPI through this card's own app or UPI ID",
} as const;
export type Condition = keyof typeof CONDITIONS;

export interface Cap {
  id: string;
  label: string;
  amount: number; // in reward units per period
  period: CapPeriod;
  /** What happens to spend beyond the cap: earn the base rate, or nothing. */
  overflow: "base" | "none";
}

export interface Rule {
  id: string;
  label: string;
  rate: number;
  merchants?: string[];
  categories?: Category[];
  excludeMerchants?: string[];
  channels?: Channel[];
  /** Only applies on these payment rails, e.g. a UPI-only rate. */
  rails?: Rail[];
  /** Only applies if the user meets this condition (e.g. Amazon Prime). */
  requires?: Condition;
  minTxn?: number;
  capId?: string;
}

export interface Tier {
  upTo: number | null; // annual spend ceiling for this slab; null = no ceiling
  rate: number;
}

export interface Card {
  id: string;
  name: string;
  issuer: string;
  network: "Visa" | "Mastercard" | "RuPay";
  upi: boolean;
  reward: {
    kind: "cashback" | "points";
    unitName: string;
    inrPerUnit: number;
    inrPerUnitNote?: string;
  };
  base: { rate: number; capId?: string; tiers?: Tier[] };
  rules: Rule[];
  caps: Cap[];
  exclusions: { categories: Category[]; merchants: string[] };
  minTxn?: number;
  notes: string[];
  sources: { label: string; url: string }[];
  lastVerified: string;
  confidence: "high" | "medium" | "low";
}

/** What the app knows about the user's usage of a card this period. */
export interface CardState {
  capUsed: Record<string, number>; // capId -> units already earned this period
  annualSpend?: number; // for tiered cards
  conditions?: Condition[]; // conditions the user meets for this card
}

export interface Recommendation {
  cardId: string;
  cardName: string;
  usable: boolean; // false = can't pay this way at all (e.g. Visa on UPI)
  rewardUnits: number;
  valueInr: number;
  effectivePct: number;
  ruleLabel: string;
  reason: string;
  warnings: string[];
  capConsumption: Record<string, number>;
  confidence: Card["confidence"];
  lastVerified: string;
}

export interface Merchant {
  id: string;
  name: string;
  category: Category;
  channel: Channel;
  aliases: string[];
}
