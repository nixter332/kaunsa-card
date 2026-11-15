// Reads bank card-alert messages (emails, and SMS text in the same formats) into transactions.
// Plain patterns, no AI: runs on the phone, so the messages never leave it.
import { findMerchant, MERCHANTS } from "./localParse";
import type { Card, Merchant } from "./types";

export type AlertTxn = {
  /** Issuer as it's named in data/cards.json, e.g. "HDFC Bank". */
  issuer: string;
  /** Last 4 digits of the card, when the message gives them. */
  last4?: string;
  /** Words in the message that narrow the card down, e.g. "visa" for "Scapia Federal Visa". */
  cardHint?: string;
  amount: number;
  /** The merchant as the bank wrote it, e.g. "PYU*Instamart Grocery". */
  merchantRaw: string;
  /** Matched shop, when the descriptor is one the app knows. */
  merchant?: Merchant;
  /** Transaction time in ms, from the message; undefined if it gives none. */
  ts?: number;
};

/** Bank wording → issuer name used in cards.json. Order matters: Scapia cards are issued by Federal Bank. */
const ISSUERS: [RegExp, string][] = [
  [/\bscapia\b/i, "Federal Bank"],
  [/\bhdfc bank\b/i, "HDFC Bank"],
  [/\baxis bank\b/i, "Axis Bank"],
  [/\bhsbc\b/i, "HSBC"],
  [/\bindusind\b/i, "IndusInd Bank"],
  [/\bsbi ?card\b|\bsbi credit card\b/i, "SBI Card"],
  [/\bicici bank\b/i, "ICICI Bank"],
  [/\bidfc first\b/i, "IDFC FIRST Bank"],
  [/\bamerican express\b|\bamex\b/i, "American Express"],
  [/\bfederal bank\b/i, "Federal Bank"],
];

/**
 * Bank mail that uses the same words but is never a card payment, seen in the owner's inbox (Nov 2026): bank-account
 * debits, account UPI alerts, OTPs, EMI schedules, statements, newsletters. On the first sync these were 73% of the emails
 * read, which used up Gmail's per-minute limit. If a bank's credit card alerts ever use one of these phrases (e.g. a RuPay
 * credit card on UPI saying "UPI txn"), take it out here; tests/alerts.test.ts checks none appears in a supported alert.
 */
export const NOT_CARD_PAYMENT = ['"was debited from your A/c"', '"UPI txn"', "subject:OTP", 'subject:"one time password"', "subject:amortization", "subject:statement", "category:promotions"];

/** Gmail search for card alerts from the banks above (senders, and words they use). */
export const GMAIL_QUERY =
  '{from:hdfcbank from:axis.bank.in from:axisbank from:hsbc from:indusind from:scapia from:sbicard from:icici from:idfcfirstbank from:americanexpress} {spent transaction "used at" txn} ' +
  NOT_CARD_PAYMENT.map((x) => `-${x}`).join(" ");

/** Words that say it's a spend (not an OTP, refund, payment received or a promo). */
const SPEND = /\bspent\b|\btransaction\b|\btxn\b|\bused (?:at|for)\b|\bpayment on\b/i;
// An OTP message says what the OTP is for; a footer like ICICI's "Never share your OTP" doesn't make an alert an OTP.
const NOT_SPEND = /\bis (?:your|the) OTP\b|\bOTP (?:is|for)\b|one[- ]time password (?:is|for)\b|\(OTP\) has been generated|\brefund(?:ed)?\b|\breversal\b|payment (?:of .* )?(?:has been )?received|\bcredited to your card\b|\bdeclined\b|\bunsuccessful\b|\bfailed\b/i;

const AMOUNT = /(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;

function findLast4(text: string): string | undefined {
  const patterns = [
    /ending(?:\s+in)?\s+[x*]*(\d{4})\b/i, // "ending 2196", "ending in 8874"
    /\b(?:xx|x|\*{2,})(\d{4})\b/i, // "x9016", "XX0574", "xx3845"
    /card\s+(?:no\.?\s*)?(\d{4})\b/i, // "Card 9016"
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m[1];
  }
  return undefined;
}

/** "Merchant Name:\nPYU*AMAZON", "Merchant\n\tRender.com + Us": the line after a "Merchant" label. */
function labeledMerchant(lines: string[]): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const m = /^merchant(?:\s+name)?\s*:?\s*(.*)$/i.exec(lines[i]);
    if (!m) continue;
    if (m[1].trim()) return m[1].trim();
    const next = lines.slice(i + 1).find((l) => l.trim());
    if (next) return next.trim();
  }
  return undefined;
}

/** ICICI: "... on Oct 19, 2026 at 11:23:57. Info: AMAZON PAY IN E COMMERCE." */
function infoMerchant(flat: string): string | undefined {
  const v = /\bInfo\s*:\s*(.+?)(?=\.(?:\s|$)|$)/i.exec(flat)?.[1]?.trim();
  return v && v.length <= 60 ? v : undefined;
}

/** "... at PYU*Instamart Grocery on 2026-11-15", "... at MAKEMYTRIP COM. Avl", "... at Makemytrip Com is Approved". */
function atMerchant(flat: string): string | undefined {
  for (const m of flat.matchAll(/\bat\s+(.+?)(?=\s+(?:on|for|is|was|using)\b|[.;](?:\s|$)|\s+Avl\b|$)/gi)) {
    const v = m[1].trim();
    if (v && !/^\d/.test(v) && v.length <= 60) return v; // "at 11:49 PM" is a time, not a shop
  }
  return undefined;
}

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

/** Transaction time from the formats the banks use, read as India time. */
function findTs(flat: string): number | undefined {
  let m = /(\d{4})-(\d{2})-(\d{2})[: ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(flat); // 2026-11-15:11:50:41
  if (m) return ist(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0));
  // ICICI: "Oct 19, 2026 at 11:23:57" (month first)
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i.exec(flat);
  if (m) {
    let hour = m[4] ? +m[4] : 12;
    if (m[7]) hour = (hour % 12) + (m[7].toLowerCase() === "pm" ? 12 : 0);
    return ist(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2], hour, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
  }
  // 15-11-2026 11:50:41, 21-10-26 14:26:17, 14/11/26, 08-11-2026 at 11:49 PM. A date with a time wins over a bare
  // date (the Axis email has a bare "22-10-2026" at the top and the full time further down).
  const dates = [...flat.matchAll(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:,?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/gi)];
  m = dates.find((d) => d[4]) ?? dates[0] ?? null;
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    let hour = m[4] ? +m[4] : 12;
    if (m[7]) hour = (hour % 12) + (m[7].toLowerCase() === "pm" ? 12 : 0);
    return ist(year, +m[2], +m[1], hour, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
  }
  m = /\b(\d{1,2})[- ](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[- ,]+(\d{2,4})/i.exec(flat); // 15 Nov 2026
  if (m) return ist(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1], 12, 0, 0);
  return undefined;
}
const ist = (y: number, mo: number, d: number, h: number, mi: number, s: number) =>
  Date.UTC(y, mo - 1, d, h, mi, s) - 5.5 * 3600_000;

/** Bank descriptors that aren't the brand's own name. */
const DESCRIPTORS: [RegExp, string][] = [
  [/\bbig ?tree\b/i, "bookmyshow"],
  [/\bbundl\b/i, "swiggy_food"],
  [/\bamazon ?pay\b|\bamazon\b/i, "amazon"],
  [/\bzomato\b|\beternal ltd\b/i, "zomato"],
  [/\bblink ?commerce\b/i, "blinkit"],
  [/\bmake ?my ?trip\b/i, "makemytrip"],
  [/\bflipkart\b/i, "flipkart"],
];

/** Strip payment-gateway prefixes and company suffixes: "PYU*Instamart Grocery" → "Instamart Grocery". */
export function cleanDescriptor(raw: string): string {
  return raw
    .replace(/^(?:[a-z]{2,6}\s*\*\s*)+/i, "") // PYU*, PTM*, RAZ*, CCA*
    .replace(/\b(?:pvt|private|ltd|limited|llp|inc|india|in|pr|com|www)\b\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How a shop is remembered on the phone once the person says what it is: "JIMIS BURGER LLP" → "JIMIS BURGER". */
export const shopKey = (raw: string) => cleanDescriptor(raw).toUpperCase();

/** The app's shop for a bank descriptor, if it knows it. Catch-alls ("Restaurant") aren't guessed from a name. */
export function merchantFor(raw: string): Merchant | undefined {
  const clean = cleanDescriptor(raw);
  for (const [re, id] of DESCRIPTORS) if (re.test(raw) || re.test(clean)) return MERCHANTS.find((m) => m.id === id);
  const m = findMerchant(clean);
  return m && !m.generic ? m : undefined;
}

/** One alert message → a transaction, or undefined if it isn't a card spend we can read. */
export function parseAlert(text: string): AlertTxn | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());
  const flat = lines.filter(Boolean).join(" ");
  if (!SPEND.test(flat) || NOT_SPEND.test(flat)) return undefined;
  if (!/credit card|\bcard\b/i.test(flat)) return undefined;
  // Debit card payments come from the bank account, so they earn nothing on a credit card. Without this, an HDFC debit
  // card e-mandate was logged on the person's only HDFC credit card (Nov 2026). HDFC's credit card SMS says "BLOCK DC",
  // so only the words "debit card" count, and only when the message doesn't also say "credit card".
  if (/\bdebit card\b/i.test(flat) && !/\bcredit card\b/i.test(flat)) return undefined;
  const issuer = ISSUERS.find(([re]) => re.test(flat))?.[1];
  const amountMatch = AMOUNT.exec(flat);
  const merchantRaw = labeledMerchant(lines) ?? infoMerchant(flat) ?? atMerchant(flat);
  if (!issuer || !amountMatch || !merchantRaw) return undefined;
  const amount = Number(amountMatch[1].replace(/,/g, ""));
  if (!(amount > 0)) return undefined;
  const hint = /\b(visa|rupay|mastercard|amex)\b/i.exec(flat)?.[1]?.toLowerCase();
  return { issuer, last4: findLast4(flat), cardHint: hint, amount, merchantRaw, merchant: merchantFor(merchantRaw), ts: findTs(flat) };
}

const normIssuer = (s: string) => s.toLowerCase().replace(/\b(bank|card|cards|ltd|limited|credit)\b/g, "").replace(/[^a-z0-9]/g, "");

/**
 * Which of the user's cards an alert is for:
 * 1. the card already linked to these last 4 digits;
 * 2. else the only card the user holds from that issuer (narrowed by network words like "Visa");
 * 3. else undefined, and the app asks once.
 */
export function matchCard(txn: AlertTxn, cards: Card[], last4Map: Record<string, string>): Card | undefined {
  if (txn.last4) {
    const id = Object.entries(last4Map).find(([, l4]) => l4 === txn.last4)?.[0];
    const linked = id && cards.find((c) => c.id === id);
    if (linked) return linked;
  }
  let same = cards.filter((c) => normIssuer(c.issuer) === normIssuer(txn.issuer) && !(txn.last4 && last4Map[c.id] && last4Map[c.id] !== txn.last4));
  if (same.length > 1 && txn.cardHint) {
    const narrowed = same.filter((c) => `${c.name} ${c.network}`.toLowerCase().includes(txn.cardHint!));
    if (narrowed.length) same = narrowed;
  }
  return same.length === 1 ? same[0] : undefined;
}

/** A stable key for an alert, so the same payment from SMS and email, or a re-sync, is logged once. */
export const txnKey = (t: AlertTxn, cardId: string) => `${cardId}|${t.amount.toFixed(2)}|${t.ts ? Math.floor(t.ts / 60_000) : t.merchantRaw.toLowerCase()}`;

/** HTML email → text with line breaks where the layout had blocks (labels like "Merchant Name:" stay on their own line). */
export function htmlToLines(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|th|li|h\d|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8377;|&#x20b9;/gi, "₹")
    .replace(/&rsquo;|&#8217;/g, "'")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
}
