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
