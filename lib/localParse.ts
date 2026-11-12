// Offline fallback parser: used when no API key is set or the API call fails.
// Also the baseline that the Claude parser is measured against.
import merchantsJson from "../data/merchants.json";
import type { Lookup, Merchant } from "./types";

export const MERCHANTS = merchantsJson as Merchant[];

/**
 * The amount in a typed payment. Text often has other numbers in it ("dinner for 2 2400",
 * "iphone 15 79999"), so a number marked as money (₹, rs, 1.5k, /-) wins; otherwise the largest one.
 */
export function parseAmount(text: string): number | null {
  const t = text.toLowerCase().replace(/(\d),(?=\d)/g, "$1");
  const nums: { value: number; marked: boolean }[] = [];
  for (const m of t.matchAll(/(?:(₹)|\b(rs\.?|inr))?\s*(\d+(?:\.\d+)?)\s*(k\b|rs\b|rupees?\b|\/-)?/g)) {
    const value = Math.round(parseFloat(m[3]) * (m[4] === "k" ? 1000 : 1));
    if (value > 0) nums.push({ value, marked: Boolean(m[1] || m[2] || m[4]) });
  }
  const pool = nums.some((n) => n.marked) ? nums.filter((n) => n.marked) : nums;
  return pool.length ? Math.max(...pool.map((n) => n.value)) : null;
}

export function findMerchant(text: string): Merchant | undefined {
  const t = ` ${text.toLowerCase()} `;
  // Longest alias first, so "swiggy dineout" beats "swiggy".
  const pairs = MERCHANTS.flatMap((m) => m.aliases.map((a) => ({ m, a })));
  pairs.sort((x, y) => y.a.length - x.a.length);
  const hits = pairs.filter(({ a }) => new RegExp(`[^a-z]${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z]`).test(t));
  // "petrol at BPCL" is BPCL, not just any fuel station.
  return (hits.find((h) => !h.m.generic) ?? hits[0])?.m;
}

export function localParse(text: string): (Lookup & { merchantName?: string }) | null {
  const amount = parseAmount(text);
  if (!amount) return null;
  const merchant = findMerchant(text);
  const lower = text.toLowerCase();
  // Bill payments inside Google Pay / Airtel Thanks are card payments unless the user says UPI.
  const billApp = merchant?.id === "gpay_bill" || merchant?.id === "airtel_utility";
  const rail = /\bupi\b|\bqr\b/.test(lower) || (!billApp && /gpay|phonepe|paytm/.test(lower)) ? "upi" : "card";
  const channel = rail === "upi" || /\boffline\b|\bstore\b|\bshop\b/.test(lower) ? "offline" : merchant?.channel ?? "offline";
  return {
    merchant: merchant?.id,
    merchantName: merchant?.name,
    category: merchant?.category ?? "other",
    amount,
    channel,
    rail,
  };
}

/**
 * What the app can read by itself while someone types, with no AI call. When it finds both a known
 * shop and an amount, the lookup is complete and the answer can show at once.
 */
export function instantRead(text: string): { merchant?: Merchant; amount?: number; lookup?: Lookup } {
  const merchant = findMerchant(text);
  if (!merchant) return {};
  // Digits inside the shop's own name ("1mg", "24 seven") aren't the amount.
  let rest = ` ${text.toLowerCase()} `;
  for (const a of [...merchant.aliases].sort((x, y) => y.length - x.length)) rest = rest.split(a).join(" ");
  const amount = parseAmount(rest) ?? undefined;
  const parsed = amount ? localParse(text) : null;
  if (!amount || !parsed) return { merchant };
  const { merchantName: _name, ...lookup } = parsed;
  return { merchant, amount, lookup: { ...lookup, amount } };
}

/** Shops whose name starts with what's been typed so far, for tap-to-complete chips. Named brands before catch-alls. */
export function suggestMerchants(text: string, limit = 4): Merchant[] {
  const typed = text.toLowerCase().replace(/[\d₹,.]/g, " ").trim();
  if (typed.length < 2 || findMerchant(text)) return [];
  const starts = (s: string) => s.startsWith(typed) || s.split(/\s+/).some((w) => w.startsWith(typed));
  return MERCHANTS.filter((m) => starts(m.name.toLowerCase()) || m.aliases.some(starts))
    .sort((a, b) => Number(Boolean(a.generic)) - Number(Boolean(b.generic)) || a.name.localeCompare(b.name))
    .slice(0, limit);
}
