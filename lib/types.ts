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
  /**
   * Shown with the answer whenever this rule applies: a limit the fields can't express,
   * e.g. a cap that depends on what you spend elsewhere ("2× your other cashback this month").
   */
  note?: string;
}

export interface Tier {
  upTo: number | null; // annual spend ceiling for this slab; null = no ceiling
  rate: number;
}

export interface Card {
  id: string;
  name: string;
  issuer: string;
  network: "Visa" | "Mastercard" | "RuPay" | "Amex";
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
  /** Best bank offer or card perk that applies right now, if any. */
  offer?: AppliedOffer;
  /** Offers that would apply with a different day or a bigger amount. */
  offerHints?: string[];
  /** The same hints with their numbers, so the screen can promote a big one. */
  offerTips?: OfferTip[];
  /** Instant discount + reward value. Equals valueInr when there's no offer. */
  totalInr: number;
}

/** An offer that needs something different (EMI, another day, a bigger amount) or is used up. */
export interface OfferTip {
  offerId: string;
  reason: "emi" | "wrong_day" | "below_min" | "used_up";
  discountInr: number;
  /** Full sentence, starting with the offer's title. */
  text: string;
  /** Without the title, e.g. "₹1,800 off with no-cost EMI (code GOINDUSEMI)". */
  short: string;
  code?: string;
  conditions?: string;
}

export interface Merchant {
  id: string;
  name: string;
  category: Category;
  channel: Channel;
  aliases: string[];
  /** A catch-all like "Fuel station" or "Restaurant": any named brand in the same text wins over it. */
  generic?: boolean;
}

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * A bank offer (time-limited, e.g. "10% off up to ₹1,500 on Goibibo with IndusInd cards")
 * or a card perk (lasting, e.g. "buy 1 get 1 on BookMyShow, twice a month").
 * Offers are instant discounts given by the merchant, on top of the card's normal rewards.
 */
export interface Offer {
  id: string;
  title: string; // short, e.g. "IndusInd × Goibibo flights"
  kind: "bank_offer" | "card_perk";
  /** Which cards: specific card ids, or every credit card from an issuer (optionally one network). */
  cardIds?: string[];
  issuer?: string;
  networks?: Card["network"][];
  excludeCardIds?: string[];
  merchants: string[]; // merchant ids from data/merchants.json
  categories?: Category[]; // narrows within the merchant, e.g. only travel
  discount: { type: "percent"; value: number; max?: number } | { type: "flat"; value: number };
  minTxn?: number;
  validFrom?: string; // YYYY-MM-DD, India time
  validTo?: string; // YYYY-MM-DD inclusive; omitted for lasting card perks
  days?: Weekday[]; // only on these days
  usesPerMonth?: number; // per card
  usesPerYear?: number; // per card, per calendar year (e.g. "1 free ticket every 6 months" = 2)
  payment?: "full" | "emi"; // "emi" = only when you pay by (no-cost) EMI
  code?: string; // coupon code to enter at checkout
  rails?: Rail[]; // defaults to card payments only
  channels?: Channel[];
  conditions?: string; // one short line shown to the user, e.g. "Domestic flights only"
  source: string; // URL or file it was read from
  lastVerified: string;
}

export interface AppliedOffer {
  id: string;
  title: string;
  kind: Offer["kind"];
  discountInr: number;
  code?: string;
  payment?: Offer["payment"];
  conditions?: string;
  validTo?: string;
}

/**
 * Everything about a card besides how it earns: fees, waivers, welcome benefit, lounges, eligibility.
 * Lives in data/card-profiles.json, filled by the card details agent (npm run profiles) and reviewed by a person.
 */
export interface CardProfile {
  id: string; // same id as in cards.json
  joiningFee: number; // ₹, before GST; 0 if free
  annualFee: number; // ₹ per year from year 2, before GST; 0 if lifetime free
  feeWaiverSpend?: number; // ₹ spent in a card year that waives the next annual fee
  welcome?: { text: string; valueInr?: number }; // one-time benefit for new cardholders
  lounge?: { domestic?: number; international?: number; note?: string }; // free visits per year; 99 = unlimited
  forexMarkupPct?: number; // e.g. 3.5
  minIncomeMonthly?: number; // ₹ per month for salaried applicants, if the bank states it
  highlights?: string[]; // up to 3 short non-reward perks, e.g. "1% fuel surcharge waiver"
  notIssued?: boolean; // existing holders keep it, but new people can't apply (never suggested as a new card)
  sources: string[];
  lastVerified: string;
}
