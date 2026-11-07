// Offline fallback parser: used when no API key is set or the API call fails.
// Also the baseline that the Claude parser is measured against.
import merchantsJson from "../data/merchants.json";
import type { Lookup, Merchant } from "./types";

export const MERCHANTS = merchantsJson as Merchant[];

export function parseAmount(text: string): number | null {
  const t = text.toLowerCase().replace(/,/g, "");
  const k = t.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (k) return Math.round(parseFloat(k[1]) * 1000);
  const n = t.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)/);
  return n ? Math.round(parseFloat(n[1])) : null;
}

export function findMerchant(text: string): Merchant | undefined {
  const t = ` ${text.toLowerCase()} `;
  // Longest alias first, so "swiggy dineout" beats "swiggy".
  const pairs = MERCHANTS.flatMap((m) => m.aliases.map((a) => ({ m, a })));
  pairs.sort((x, y) => y.a.length - x.a.length);
  return pairs.find(({ a }) => new RegExp(`[^a-z]${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z]`).test(t))?.m;
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
