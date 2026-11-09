// Checks behind "AI never invents a rate": every rule's evidence quote must really be in the bank's
// document, and must contain the rule's number. Pure functions; the scripts load the documents.
import type { Card, Rule } from "./types";

/** Text reduced to letters, digits, % and dots, so PDF line breaks, curly quotes and "Rs." vs "₹" don't matter. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/₹|\brs\.?|\binr\b/g, " rs ")
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/(\d)\s+(?=%)/g, "$1")
    .replace(/[^a-z0-9%.]+/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Is the quote in the document? A quote may skip words with "..." or "…"; each piece must be there.
 * Pieces under 3 words are ignored (too short to prove anything), but at least one piece must count.
 */
export function quoteFound(docText: string, quote: string, normalizedDoc = normalizeText(docText)): boolean {
  const pieces = quote
    .split(/\.{3,}|…|\[\.\.\.\]/)
    .map(normalizeText)
    .filter((p) => p.split(" ").length >= 3);
  return pieces.length > 0 && pieces.every((p) => normalizedDoc.includes(p));
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.011;

/**
 * Does the quote state this rule's rate? Accepts the ways banks write it: "5%", "10 points per ₹100",
 * "5 points per ₹150/₹200/₹50", "10X" (a multiple of the base rate), or the value % for points.
 */
export function quoteHasRate(quote: string, rule: Pick<Rule, "rate">, card: Pick<Card, "base" | "reward">): boolean {
  const q = normalizeText(quote);
  const numbers = [...q.matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]));
  const multiples = [...q.matchAll(/(\d+(?:\.\d+)?)\s?x\b/g)].map((m) => parseFloat(m[1]));
  // "per ₹150" style blocks only count when the quote names that block.
  const blocks = [...q.matchAll(/per (?:rs )?(\d+)/g)].map((m) => parseFloat(m[1]));
  const expected = [rule.rate * 100, rule.rate * card.reward.inrPerUnit * 100, ...blocks.map((block) => rule.rate * block)];
  if (numbers.some((n) => expected.some((e) => near(n, e)))) return true;
  // "10X" means 10 times the card's base, or 10 points per ₹100/150/200 when "1X" is 1 point per block
  // (IDFC's 1X is 1 point per ₹150, and its everyday rate is 3X).
  return multiples.some((x) => (card.base.rate > 0 && near(x, rule.rate / card.base.rate)) || [100, 150, 200].some((block) => near(x, rule.rate * block)));
}

export type EvidenceCheck = { found: boolean; hasRate: boolean; source?: string };

/** Check one quote against several documents; source = the first document that contains it. */
export function checkQuote(docs: { source: string; text: string }[], quote: string, rule: Pick<Rule, "rate">, card: Pick<Card, "base" | "reward">): EvidenceCheck {
  const hit = docs.find((d) => quoteFound(d.text, quote));
  return { found: Boolean(hit), hasRate: quoteHasRate(quote, rule, card), source: hit?.source };
}
